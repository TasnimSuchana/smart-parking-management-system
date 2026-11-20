import { useEffect, useRef, useState } from 'react';
import { useTitle } from '../hooks/useTitle.js';
import { useAsync } from '../hooks/useAsync.js';
import { useSocket } from '../hooks/useSocket.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import api, { unwrap } from '../services/api.js';
import { Spinner, ErrorBox, Empty, Confirm, Field } from '../components/UI.jsx';
import { errMsg } from '../utils/format.js';

const STATUS_LABEL = { idle: 'Camera off', starting: 'Requesting camera...', live: 'Live', denied: 'Permission denied', disconnected: 'Camera disconnected', error: 'Error' };

export default function CameraMonitor() {
  useTitle('Camera monitoring'); const { user } = useAuth(); const toast = useToast();
  const zones = useAsync(() => unwrap(api.get('/camera/zones')), []);
  const [zoneId, setZoneId] = useState(''); const [state, setState] = useState('idle'); const [analysis, setAnalysis] = useState(null); const [note, setNote] = useState('');
  const [events, setEvents] = useState([]); const [calib, setCalib] = useState(false);
  const video = useRef(null), stream = useRef(null), session = useRef(null), timers = useRef([]);
  const zone = zones.data?.find((z) => z._id === (zoneId || zones.data?.[0]?._id));
  const { connected } = useSocket({ 'camera:detection': (e) => setEvents((l) => [`${new Date().toLocaleTimeString()} slot ${e.label} -> ${e.status}`, ...l].slice(0, 8)), 'camera:session': (e) => setEvents((l) => [`${new Date().toLocaleTimeString()} session ${e.status}`, ...l].slice(0, 8)) }, { locationId: zone?.locationId });

  const stop = async (final = 'idle') => {
    timers.current.forEach(clearInterval); timers.current = [];
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    if (session.current) { api.delete(`/camera/sessions/${session.current}`).catch(() => {}); session.current = null; }
    setState(final);
  };
  useEffect(() => () => { stop(); }, []); // eslint-disable-line

  const start = async () => {
    if (!zone) return; setNote(''); setAnalysis(null); setState('starting');
    try {
      // Permission is requested only now, when monitoring starts. Rear camera preferred on phones.
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    } catch (e) { setState(e.name === 'NotAllowedError' ? 'denied' : 'error'); setNote(e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser settings and try again.' : 'No usable camera was found.'); return; }
    try { const s = await unwrap(api.post('/camera/sessions', { zoneId: zone._id })); session.current = s._id; }
    catch (e) { setNote(errMsg(e)); await stop('error'); return; }
    video.current.srcObject = stream.current; await video.current.play().catch(() => {}); setState('live');
    stream.current.getVideoTracks()[0].addEventListener('ended', () => stop('disconnected')); // cable/permission revoked
    const hb = setInterval(() => session.current && api.post(`/camera/sessions/${session.current}/heartbeat`).catch(() => {}), 15000);
    const cap = setInterval(async () => {
      const v = video.current; if (!v?.videoWidth) return;
      const c = document.createElement('canvas'); const w = Math.min(960, v.videoWidth); c.width = w; c.height = Math.round((v.videoHeight / v.videoWidth) * w); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7));
      try { setAnalysis(await unwrap(api.post(`/camera/zones/${zone._id}/detect`, blob, { headers: { 'Content-Type': 'image/jpeg' } }))); setNote(''); }
      catch (e) { setNote(errMsg(e)); }
    }, 3000);
    timers.current = [hb, cap];
  };
  const override = async (slotId, status) => { try { await api.patch(`/camera/zones/${zone._id}/slots/${slotId}`, { status }); toast('Slot updated'); } catch (e) { toast(errMsg(e), 'error'); } };

  if (zones.loading) return <Spinner />; if (zones.error) return <ErrorBox message={zones.error} onRetry={zones.reload} />;
  return (
    <div className="stack"><h1>Camera monitoring</h1>
      {!zones.data.length ? <Empty title="No camera zones configured" hint="Create a zone below, then calibrate it." /> : (
        <section className="glass card stack">
          <div className="row"><div style={{ flex: 1, minWidth: 220 }}><label className="small muted" htmlFor="zone">Zone</label><select id="zone" value={zone?._id} disabled={state !== 'idle'} onChange={(e) => setZoneId(e.target.value)}>{zones.data.map((z) => <option key={z._id} value={z._id}>{z.name}{z.calibratedAt ? '' : ' (not calibrated)'}</option>)}</select></div>
            <span className="small"><span className={`dot ${state === 'live' ? 'on' : 'off'}`} /> {STATUS_LABEL[state]} &middot; realtime {connected ? 'connected' : 'reconnecting'}</span></div>
          <video ref={video} className="video" muted playsInline aria-label="Live camera preview" style={{ display: state === 'live' ? 'block' : 'none' }} />
          <div className="row">{state === 'live' ? <button className="btn danger" onClick={() => stop()}>Stop monitoring</button> : <button className="btn primary" disabled={!zone || state === 'starting'} onClick={start}>Start monitoring</button>}</div>
          {note && <p className={state === 'denied' || state === 'error' || state === 'disconnected' ? 'err' : 'muted small'} role="alert">{note}</p>}
          {state === 'disconnected' && <p className="err">The camera disconnected. Reconnect it and start monitoring again.</p>}
          <p className="small muted">Frames are analysed on the server and are not stored. Detection only applies to slots inside the calibrated zone for this fixed camera position.</p>
          {analysis && <div><h3>Detections ({analysis.vehicles} vehicle{analysis.vehicles === 1 ? '' : 's'})</h3><div className="table-wrap"><table><thead><tr><th>Slot</th><th>Detected</th><th>Consecutive frames</th><th>Applied</th><th>Manual correction</th></tr></thead><tbody>{analysis.slots.map((s) => <tr key={s.slotId}><td>{s.label}</td><td>{s.detectedOccupied ? 'occupied' : 'empty'}</td><td>{s.consecutiveFrames}</td><td>{s.applied ? 'yes' : '-'}</td><td className="row"><button className="btn sm" onClick={() => override(s.slotId, 'occupied')}>Occupied</button><button className="btn sm" onClick={() => override(s.slotId, 'available')}>Available</button></td></tr>)}</tbody></table></div></div>}
          {events.length > 0 && <ul className="small muted">{events.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </section>)}
      {user.role === 'admin' && <ZoneAdmin zones={zones.data} reload={zones.reload} />}
    </div>
  );
}

function ZoneAdmin({ zones, reload }) {
  const toast = useToast(); const locs = useAsync(() => unwrap(api.get('/parking/admin/locations')), []);
  const [f, setF] = useState({ locationId: '', name: '' }); const [del, setDel] = useState(null); const [calZone, setCalZone] = useState(null);
  const create = async (e) => { e.preventDefault(); try { await api.post('/camera/zones', { locationId: f.locationId || locs.data[0]._id, name: f.name }); setF({ ...f, name: '' }); toast('Zone created'); reload(); } catch (x) { toast(errMsg(x), 'error'); } };
  const remove = async () => { try { await api.delete(`/camera/zones/${del._id}`); toast('Zone deleted'); reload(); } catch (x) { toast(errMsg(x), 'error'); } setDel(null); };
  return (
    <section className="glass card stack"><h2>Zones & calibration</h2>
      <form className="row" onSubmit={create}><select aria-label="Location" style={{ width: 'auto' }} value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}>{(locs.data || []).map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</select><input aria-label="Zone name" style={{ flex: 1, minWidth: 160 }} placeholder="Zone name, e.g. Level 1 - North camera" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={80} /><button className="btn primary">Add zone</button></form>
      {zones.map((z) => <div key={z._id} className="row between"><span>{z.name} <span className="small muted">({z.slots.length} slots mapped)</span></span><span className="row"><button className="btn sm" onClick={() => setCalZone(z)}>Calibrate</button><button className="btn sm danger" onClick={() => setDel(z)}>Delete</button></span></div>)}
      {calZone && <Calibrator zone={calZone} onClose={() => { setCalZone(null); reload(); }} />}
      {del && <Confirm title="Delete zone?" message={`Delete "${del.name}" and its calibration?`} confirmLabel="Delete" onConfirm={remove} onClose={() => setDel(null)} />}
    </section>
  );
}

// Calibration: capture a still from the fixed camera, then draw one rectangle per slot.
function Calibrator({ zone, onClose }) {
  const toast = useToast(); const slotsQ = useAsync(() => unwrap(api.get(`/parking/locations/${zone.locationId}/slots`)), []);
  const canvas = useRef(null), video = useRef(null), stream = useRef(null); const [captured, setCaptured] = useState(false);
  const [map, setMap] = useState(() => Object.fromEntries(zone.slots.map((s) => [s.slotId, s.rect]))); const [slotId, setSlotId] = useState(''); const drag = useRef(null);
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);
  const open = async () => { try { stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); video.current.srcObject = stream.current; await video.current.play(); } catch { toast('Camera unavailable or permission denied', 'error'); } };
  const draw = (live) => { const c = canvas.current; if (!c) return; const g = c.getContext('2d'); if (live) g.drawImage(live, 0, 0, c.width, c.height); };
  const capture = () => { const v = video.current; const c = canvas.current; c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0); c.dataset.bg = c.toDataURL(); stream.current?.getTracks().forEach((t) => t.stop()); setCaptured(true); };
  useEffect(() => { // redraw background + rectangles
    const c = canvas.current; if (!captured || !c) return; const img = new Image(); img.onload = () => { const g = c.getContext('2d'); g.drawImage(img, 0, 0); g.lineWidth = Math.max(2, c.width / 300); g.font = `${Math.round(c.width / 40)}px sans-serif`;
      for (const [id, r] of Object.entries(map)) { g.strokeStyle = '#22d3ee'; g.strokeRect(r.x * c.width, r.y * c.height, r.w * c.width, r.h * c.height); g.fillStyle = '#22d3ee'; g.fillText(slotsQ.data?.find((s) => s.id === id)?.label || '', r.x * c.width + 4, r.y * c.height + parseInt(g.font) + 2); } }; img.src = c.dataset.bg; }, [map, captured, slotsQ.data]);
  const pos = (e) => { const r = canvas.current.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  const down = (e) => { if (!slotId) return toast('Choose a slot first', 'error'); drag.current = pos(e); canvas.current.setPointerCapture(e.pointerId); };
  const up = (e) => { if (!drag.current) return; const a = drag.current, b = pos(e); drag.current = null; const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; if (r.w > 0.01 && r.h > 0.01) setMap((m) => ({ ...m, [slotId]: r })); };
  const save = async () => { try { await api.put(`/camera/zones/${zone._id}/calibration`, { slots: Object.entries(map).map(([id, rect]) => ({ slotId: id, label: slotsQ.data.find((s) => s.id === id)?.label || '', rect })) }); toast('Calibration saved'); onClose(); } catch (e) { toast(errMsg(e), 'error'); } };
  return (
    <div className="glass card stack"><h3>Calibrate: {zone.name}</h3>
      <p className="small muted">Mount the camera in its final position, capture a still, select a slot, then drag a rectangle over that slot in the image.</p>
      {!captured && <><video ref={video} className="video" muted playsInline /><div className="row"><button className="btn" onClick={open}>Open camera</button><button className="btn primary" onClick={capture}>Capture still</button></div></>}
      {captured && <><Field label="Slot to map" id="cs"><select id="cs" value={slotId} onChange={(e) => setSlotId(e.target.value)}><option value="">Select...</option>{(slotsQ.data || []).map((s) => <option key={s.id} value={s.id}>{s.label}{map[s.id] ? ' (mapped)' : ''}</option>)}</select></Field>
        <div className="canvas-wrap"><canvas ref={canvas} onPointerDown={down} onPointerUp={up} aria-label="Calibration image: drag to draw the slot rectangle" /></div></>}
      {!captured && <canvas ref={canvas} style={{ display: 'none' }} />}
      <div className="row"><button className="btn primary" disabled={!captured || !Object.keys(map).length} onClick={save}>Save calibration</button><button className="btn" onClick={onClose}>Close</button></div>
    </div>
  );
}
