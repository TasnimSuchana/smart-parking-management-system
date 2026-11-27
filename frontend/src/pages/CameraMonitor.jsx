import { useEffect, useRef, useState } from 'react';
import { useTitle } from '../hooks/useTitle.js';
import { useAsync } from '../hooks/useAsync.js';
import { useSocket } from '../hooks/useSocket.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import api, { unwrap } from '../services/api.js';
import { Spinner, ErrorBox, Empty, Confirm, Field } from '../components/UI.jsx';
import { errMsg } from '../utils/format.js';

const pct = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`);
const hms = (d) => new Date(d).toLocaleTimeString([], { hour12: false });
const CAM_STATE = { idle: ['off', 'Offline'], starting: ['warn', 'Connecting'], live: ['on', 'Online'], denied: ['off', 'Permission denied'], error: ['off', 'Error'], disconnected: ['off', 'Disconnected'] };
const box = (r) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });

// Camera frame with the calibrated slot rectangles and detected vehicles drawn on top (all coordinates are normalised 0-1).
function Stage({ videoRef, live, aspect, zone, analysis, sim }) {
  const bySlot = new Map((analysis?.slots || []).map((x) => [x.slotId, x]));
  return (
    <div className="stage" style={{ aspectRatio: aspect }}>
      <video ref={videoRef} muted playsInline aria-label="Live camera preview" style={{ display: live ? 'block' : 'none' }} />
      {!live && <div className="stage-empty"><strong>{sim ? 'Simulated scene' : 'Camera is off'}</strong><span className="small muted">{sim ? 'Demo only. No camera or detector is being used.' : 'Press Start monitoring to open the camera.'}</span></div>}
      {live && <span className="pill live">&#9679; LIVE</span>}{sim && <span className="pill sim">SIMULATION</span>}
      {zone?.slots.map((sl) => { const st = bySlot.get(sl.slotId); const occ = (st?.detectedOccupied) || (sim && sim.slotId === sl.slotId && sim.phase !== 'detected');
        return <div key={sl.slotId} className={`slot-rect ${occ ? 'occ' : 'free'}`} style={box(sl.rect)}><span>{sl.label}</span></div>; })}
      {analysis?.detections?.map((d, i) => <div key={i} className="det-box" style={box(d.box)}><span>{d.label.toUpperCase()} {pct(d.confidence)}</span></div>)}
      {sim && <div className="det-box sim" style={box(sim.rect)}><span>CAR {sim.conf}%</span></div>}
    </div>
  );
}

export default function CameraMonitor() {
  useTitle('Camera monitoring'); const { user } = useAuth(); const toast = useToast();
  const zones = useAsync(() => unwrap(api.get('/camera/zones')), []);
  const [zoneId, setZoneId] = useState(''); const [state, setState] = useState('idle'); const [analysis, setAnalysis] = useState(null); const [note, setNote] = useState('');
  const [detector, setDetector] = useState('unknown'); const [frames, setFrames] = useState(0); const [aspect, setAspect] = useState('16 / 9');
  const [history, setHistory] = useState([]); const [simLog, setSimLog] = useState([]); const [sim, setSim] = useState(null);
  const video = useRef(null), stream = useRef(null), session = useRef(null), timers = useRef([]), simTimers = useRef([]), reloadT = useRef(null);
  const zone = zones.data?.find((z) => z._id === (zoneId || zones.data?.[0]?._id));
  const hist = useAsync(() => (zone ? unwrap(api.get(`/camera/zones/${zone._id}/history`, { params: { limit: 30 } })) : Promise.resolve([])), [zone?._id]); // eslint-disable-line
  useEffect(() => { if (hist.data) setHistory(hist.data); }, [hist.data]);
  const { connected } = useSocket({ 'camera:event': () => { clearTimeout(reloadT.current); reloadT.current = setTimeout(() => hist.reload(), 800); } }, { locationId: zone?.locationId });

  const stop = async (final = 'idle') => {
    timers.current.forEach(clearInterval); timers.current = [];
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    if (session.current) { api.delete(`/camera/sessions/${session.current}`).catch(() => {}); session.current = null; }
    setState(final); setAnalysis(null);
  };
  useEffect(() => () => { stop(); simTimers.current.forEach(clearTimeout); clearTimeout(reloadT.current); }, []); // eslint-disable-line

  const start = async () => {
    if (!zone) return; setNote(''); setAnalysis(null); setState('starting'); setFrames(0);
    try { // Permission is requested only now. Rear camera preferred on phones.
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    } catch (e) { setState(e.name === 'NotAllowedError' ? 'denied' : 'error'); setNote(e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser settings and try again.' : 'No usable camera was found.'); return; }
    try { const s = await unwrap(api.post('/camera/sessions', { zoneId: zone._id })); session.current = s._id; }
    catch (e) { setNote(errMsg(e)); await stop('error'); return; }
    video.current.srcObject = stream.current; await video.current.play().catch(() => {});
    if (video.current.videoWidth) setAspect(`${video.current.videoWidth} / ${video.current.videoHeight}`);
    setState('live'); stream.current.getVideoTracks()[0].addEventListener('ended', () => stop('disconnected'));
    const hb = setInterval(() => session.current && api.post(`/camera/sessions/${session.current}/heartbeat`).catch(() => {}), 15000);
    const cap = setInterval(async () => {
      const v = video.current; if (!v?.videoWidth) return;
      const c = document.createElement('canvas'); const w = Math.min(960, v.videoWidth); c.width = w; c.height = Math.round((v.videoHeight / v.videoWidth) * w); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7));
      try {
        const r = await unwrap(api.post(`/camera/zones/${zone._id}/detect`, blob, { headers: { 'Content-Type': 'image/jpeg' } }));
        setAnalysis(r); setDetector('online'); setNote(''); setFrames((n) => n + 1);
        if (r.events?.length) setHistory((h) => [...r.events, ...h.filter((x) => !r.events.some((e) => e.id === x.id))].slice(0, 50));
      } catch (e) { if (e?.response?.data?.error?.code === 'DETECTOR_UNAVAILABLE') setDetector('unavailable'); setNote(errMsg(e)); }
    }, 3000);
    timers.current = [hb, cap];
  };

  // Demo simulation: client-side only. Nothing is sent to the server, no slot is changed, every entry is labelled "simulated".
  const runDemo = () => {
    simTimers.current.forEach(clearTimeout); const sl = zone?.slots?.[0]; const rect = sl?.rect || { x: 0.35, y: 0.4, w: 0.3, h: 0.3 }; const label = sl?.label || 'A-12';
    const conf = 90 + Math.floor(Math.random() * 7); const plate = 'DHA-12-3456'; const base = { rect, slotId: sl?.slotId, label, conf, plate };
    const log = (type, message) => setSimLog((l) => [{ id: `sim-${Date.now()}-${type}`, type, message, slot: label, confidence: conf / 100, plate, simulated: true, at: new Date().toISOString() }, ...l].slice(0, 12));
    setSim({ ...base, phase: 'detected' }); log('vehicle_detected', 'Vehicle detected');
    simTimers.current = [setTimeout(() => { setSim({ ...base, phase: 'confirmed' }); log('vehicle_confirmed', 'Vehicle confirmed'); }, 2500),
      setTimeout(() => { setSim({ ...base, phase: 'occupied' }); log('slot_occupied', `Slot ${label} occupied`); }, 5000), setTimeout(() => setSim(null), 14000)];
  };
  const override = async (slotId, status) => { try { await api.patch(`/camera/zones/${zone._id}/slots/${slotId}`, { status }); toast('Slot updated'); hist.reload(); } catch (e) { toast(errMsg(e), 'error'); } };

  if (zones.loading) return <Spinner label="Loading cameras..." />; if (zones.error) return <ErrorBox message={zones.error} onRetry={zones.reload} />;
  const [dotCls, stateLabel] = CAM_STATE[state];
  // Focus: the sim vehicle, otherwise the most confident occupied slot in the latest analysed frame.
  const live = analysis?.slots?.filter((x) => x.detectedOccupied).sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
  const focus = sim ? { slot: sim.label, plate: sim.plate, confidence: sim.conf / 100, occupied: sim.phase === 'occupied', confirming: sim.phase === 'detected' ? 1 : sim.phase === 'confirmed' ? 2 : null, simulated: true }
    : live ? { slot: live.label, plate: live.plate, confidence: live.confidence, occupied: live.applied || live.consecutiveFrames >= (analysis.framesRequired || 3), confirming: live.consecutiveFrames < (analysis.framesRequired || 3) ? live.consecutiveFrames : null } : null;
  const events = [...simLog, ...history].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 30);
  return (
    <div className="stack"><h1>Camera monitoring</h1>
      {!zones.data.length ? <Empty title="No camera zones configured" hint="Create a zone below, then calibrate it." /> : (
        <section className="glass card stack">
          <div className="row between"><div className="row"><div><label className="small muted" htmlFor="zone">Camera</label><select id="zone" value={zone?._id} disabled={state !== 'idle'} onChange={(e) => { setZoneId(e.target.value); setSimLog([]); setSim(null); }}>{zones.data.map((z) => <option key={z._id} value={z._id}>{z.name}{z.calibratedAt ? '' : ' (not calibrated)'}</option>)}</select></div></div>
            <div className="cam-status"><span><span className={`dot ${dotCls}`} /> <strong>{stateLabel}</strong></span>
              <span className="small muted">Detector: {detector === 'online' ? 'online' : detector === 'unavailable' ? 'not available' : 'waiting'}</span><span className="small muted">Realtime: {connected ? 'connected' : 'reconnecting'}</span><span className="small muted">Frames analysed: {frames}</span></div></div>
          <div className="cam-grid">
            <Stage videoRef={video} live={state === 'live'} aspect={aspect} zone={zone} analysis={analysis} sim={sim} />
            <div className="stack">
              <div className="kv"><span className="muted small">Detected (plate)</span><strong>{focus?.plate ? focus.plate : focus ? 'Not read' : '-'}</strong>{focus && !focus.plate && <span className="small muted">Plate reading needs an ANPR-capable detector.</span>}{focus?.simulated && <span className="small" style={{ color: 'var(--warn)' }}>Simulated value</span>}</div>
              <div className="kv"><span className="muted small">Confidence</span><strong>{focus ? pct(focus.confidence) : '-'}</strong></div>
              <div className="kv"><span className="muted small">Slot</span><strong>{focus?.slot || '-'}</strong></div>
              <div className="kv"><span className="muted small">Status</span><strong>{!focus ? '-' : focus.confirming ? <><span className="dot warn" /> Confirming {focus.confirming}/{analysis?.framesRequired || 3}</> : <><span className="dot off" /> Occupied</>}</strong></div>
            </div></div>
          <div className="row">{state === 'live' ? <button className="btn danger" onClick={() => stop()}>Stop monitoring</button> : <button className="btn primary" disabled={!zone || state === 'starting'} onClick={start}>Start monitoring</button>}
            <button className="btn" onClick={runDemo} disabled={!zone || !!sim} title="Client-side demo; does not touch real slots">Run demo simulation</button></div>
          {note && <p className={state === 'live' ? 'muted small' : 'err'} role="alert">{note}</p>}
          {state === 'disconnected' && <p className="err">The camera disconnected. Reconnect it and start monitoring again.</p>}
          <p className="small muted">Frames are analysed on the server and are not stored. A slot only changes after {analysis?.framesRequired || 3} consistent frames. Boxes: green = free slot, red = occupied slot, cyan = detected vehicle. Simulation is for demonstration only.</p>
          {analysis?.slots?.length > 0 && <div className="table-wrap"><table><thead><tr><th>Slot</th><th>Detected</th><th>Confidence</th><th>Frames</th><th>Applied</th><th>Manual correction</th></tr></thead><tbody>{analysis.slots.map((x) => <tr key={x.slotId}><td>{x.label}</td><td>{x.detectedOccupied ? 'occupied' : 'empty'}</td><td>{pct(x.confidence)}</td><td>{x.consecutiveFrames}/{analysis.framesRequired}</td><td>{x.applied ? 'yes' : '-'}</td><td className="row"><button className="btn sm" onClick={() => override(x.slotId, 'occupied')}>Occupied</button><button className="btn sm" onClick={() => override(x.slotId, 'available')}>Available</button></td></tr>)}</tbody></table></div>}
        </section>)}
      {zones.data.length > 0 && <section className="glass card"><h2>Detection history</h2>
        {!events.length ? <p className="muted small">No detections yet. Start monitoring to see events here.</p> : <ul className="timeline">{events.map((e) => <li key={e.id}><time>{hms(e.at)}</time><span className={`dot t-${e.type}`} /><span>{e.message}{e.confidence != null && e.type !== 'slot_occupied' && e.type !== 'slot_available' ? ` (${pct(e.confidence)})` : ''}{e.plate ? ` · ${e.plate}` : ''}{e.simulated && <em className="small" style={{ color: 'var(--warn)' }}> simulated</em>}</span></li>)}</ul>}</section>}
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
