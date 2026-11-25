import { useEffect, useRef, useState } from 'react';
import { useTitle } from '../../hooks/useTitle.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useToast } from '../../context/ToastContext.jsx';
import api, { unwrap } from '../../services/api.js';
import { Spinner, ErrorBox, Empty, Badge } from '../../components/UI.jsx';
import { dt, errMsg, money } from '../../utils/format.js';

// QR gate workflow: paste or scan the ticket -> VERIFY (signature, booking, window, payment) -> record entry or exit.
export function Scan() {
  useTitle('Scan tickets'); const toast = useToast(); const vref = useRef(null); const stream = useRef(null);
  const [token, setToken] = useState(''); const [res, setRes] = useState(null); const [done, setDone] = useState(null); const [cam, setCam] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setCam(false); };
  useEffect(() => stop, []);
  const verify = async (code = token) => {
    setBusy(true); setErr(''); setDone(null); setRes(null);
    try { setRes(await unwrap(api.post('/qr/verify', { token: code.trim() }))); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const start = async () => {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); setCam(true);
      await new Promise((r) => setTimeout(r, 50)); vref.current.srcObject = stream.current; await vref.current.play();
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      const loop = async () => { if (!stream.current) return; try { const c = await det.detect(vref.current); if (c[0]) { setToken(c[0].rawValue); stop(); verify(c[0].rawValue); return; } } catch { /* retry */ } setTimeout(loop, 400); }; loop();
    } catch (e) { toast(e.name === 'NotAllowedError' ? 'Camera permission was denied. Paste the ticket code instead.' : 'Could not open the camera.', 'error'); stop(); }
  };
  const record = async (action) => {
    setBusy(true); setErr('');
    try { const r = await unwrap(api.post('/qr/scan', { token: token.trim(), action })); setDone({ action, ...r }); setRes(null); setToken(''); toast(action === 'entry' ? 'Entry recorded' : 'Exit recorded'); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const b = res?.booking;
  return (
    <div className="stack"><h1>Scan QR tickets</h1>
      <section className="glass card stack">
        {supported ? (cam ? <><video ref={vref} className="video" muted playsInline /><button className="btn" onClick={stop}>Stop camera</button></> : <button className="btn" onClick={start}>Open camera to scan</button>) : <p className="muted small">This browser cannot scan QR codes. Paste the ticket code below.</p>}
        <div className="field"><label htmlFor="tok">Ticket code</label><input id="tok" value={token} onChange={(e) => { setToken(e.target.value); setRes(null); setDone(null); }} autoComplete="off" /></div>
        <div className="row"><button className="btn primary" disabled={!token.trim() || busy} onClick={() => verify()}>{busy && !res ? 'Verifying...' : 'Verify ticket'}</button></div>
        {err && <p className="err" role="alert">{err}</p>}
      </section>
      {res && !res.valid && <section className="glass card stack" role="alert" style={{ borderColor: 'rgba(248,113,113,.5)' }}><h2 style={{ color: 'var(--bad)' }}>Ticket rejected</h2><p>{res.reason}</p>{b && <p className="small muted">{b.bookingNo} · {b.locationName} · slot {b.slotLabel} · status {b.status}</p>}</section>}
      {res?.valid && b && <section className="glass card stack" style={{ borderColor: 'rgba(52,211,153,.5)' }}>
        <div className="row between"><h2 style={{ margin: 0 }}>Booking #{b.bookingNo}</h2><span className="badge b-available">VALID</span></div>
        <div className="grid g2 small"><div><span className="muted">Vehicle</span><br />{b.plateMasked}</div><div><span className="muted">Location</span><br />{b.locationName}</div><div><span className="muted">Slot</span><br />{b.slotLabel}</div>
          <div><span className="muted">Booked window</span><br />{dt(b.start)} to {dt(b.end)}</div><div><span className="muted">Booking status</span><br /><Badge value={b.status} /></div><div><span className="muted">Payment</span><br />{res.payment ? <><Badge value={res.payment.status} /> {money(res.payment.amount)}</> : '-'}</div></div>
        {res.nextAction === 'entry' && <div className="row"><button className="btn primary" disabled={busy} onClick={() => record('entry')}>Record Entry</button></div>}
        {res.nextAction === 'exit' && <>
          <div className="grid g2 small"><div><span className="muted">Entry time</span><br />{dt(res.exitPreview.entryAt)}</div><div><span className="muted">Exit time (now)</span><br />{dt(res.exitPreview.exitAt)}</div><div><span className="muted">Parking duration</span><br />{res.exitPreview.durationMinutes} min</div><div><span className="muted">Current / final amount</span><br /><strong>{res.exitPreview.amount != null ? money(res.exitPreview.amount, res.exitPreview.currency) : 'n/a'}</strong></div></div>
          <div className="row"><button className="btn primary" disabled={busy} onClick={() => record('exit')}>Record Exit</button></div></>}
      </section>}
      {done && <section className="glass card" role="status"><h2>{done.action === 'entry' ? 'Entry recorded' : 'Exit recorded'}</h2><p>{done.message}</p><p className="small muted">Booking status: <Badge value={done.status} /> · Slot {done.slotLabel} is now {done.action === 'entry' ? 'occupied' : 'available'}.</p></section>}
      <PendingPayments /></div>
  );
}

function PendingPayments() {
  const toast = useToast(); const p = useAsync(() => unwrap(api.get('/payments/pending')), []);
  const pay = async (id, method) => { try { await api.patch(`/payments/${id}/paid`, { method }); toast('Payment recorded'); p.reload(); } catch (e) { toast(errMsg(e), 'error'); } };
  if (p.loading || p.error || !p.data.length) return null;
  return <section className="glass card table-wrap"><h2>Awaiting payment</h2><table><thead><tr><th>Created</th><th>Booking</th><th>Amount due</th><th>Status</th><th>Record payment</th></tr></thead><tbody>{p.data.map((x) => <tr key={x.id}><td>{dt(x.createdAt)}</td><td>{x.bookingNo}</td><td>{money(x.outstanding, x.currency)}</td><td><Badge value={x.status} /></td><td className="row">{['cash', 'card_terminal', 'mobile_banking'].map((m) => <button key={m} className="btn sm" onClick={() => pay(x.id, m)}>{m.replace('_', ' ')}</button>)}</td></tr>)}</tbody></table></section>;
}

export function DailyRecords() {
  useTitle('Daily records'); const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const r = useAsync(() => unwrap(api.get('/bookings/daily', { params: { date } })), [date]);
  return <div className="stack"><h1>Daily records</h1><div className="glass card"><label className="small muted" htmlFor="d">Date</label><input id="d" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 220 }} /></div>
    {r.loading ? <Spinner /> : r.error ? <ErrorBox message={r.error} onRetry={r.reload} /> : !r.data.length ? <Empty title="No records for this day" /> : <div className="glass card table-wrap"><table><thead><tr><th>Slot</th><th>Vehicle</th><th>Booked</th><th>Entry</th><th>Exit</th><th>Status</th></tr></thead><tbody>{r.data.map((x) => <tr key={x.id}><td>{x.slotLabel}</td><td>{x.plateMasked}</td><td>{dt(x.start)} - {dt(x.end)}</td><td>{dt(x.entryAt)}</td><td>{dt(x.exitAt)}</td><td><Badge value={x.status} /></td></tr>)}</tbody></table></div>}</div>;
}
