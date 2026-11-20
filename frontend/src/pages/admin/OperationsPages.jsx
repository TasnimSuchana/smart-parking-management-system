import { useEffect, useRef, useState } from 'react';
import { useTitle } from '../../hooks/useTitle.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useToast } from '../../context/ToastContext.jsx';
import api, { unwrap } from '../../services/api.js';
import { Spinner, ErrorBox, Empty, Badge } from '../../components/UI.jsx';
import AnimatedCheck from '../../ui/AnimatedCheck.jsx';
import { dt, errMsg, money } from '../../utils/format.js';

// Scans a QR ticket via the BarcodeDetector API when the browser supports it; manual entry is always available.
export function Scan() {
  useTitle('Scan tickets'); const toast = useToast(); const vref = useRef(null); const stream = useRef(null);
  const [token, setToken] = useState(''); const [result, setResult] = useState(null); const [cam, setCam] = useState(false); const [busy, setBusy] = useState(false);
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setCam(false); };
  useEffect(() => stop, []);
  const start = async () => {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); setCam(true);
      await new Promise((r) => setTimeout(r, 50)); vref.current.srcObject = stream.current; await vref.current.play();
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      const loop = async () => { if (!stream.current) return; try { const c = await det.detect(vref.current); if (c[0]) { setToken(c[0].rawValue); stop(); return; } } catch { /* retry */ } setTimeout(loop, 400); }; loop();
    } catch (e) { toast(e.name === 'NotAllowedError' ? 'Camera permission was denied. Paste the ticket code instead.' : 'Could not open the camera.', 'error'); stop(); }
  };
  const scan = async (action) => { setBusy(true); setResult(null); try { setResult({ ok: true, ...(await unwrap(api.post('/qr/scan', { token: token.trim(), action }))) }); toast(`${action === 'entry' ? 'Entry' : 'Exit'} recorded`); setToken(''); } catch (e) { setResult({ ok: false, message: errMsg(e) }); } finally { setBusy(false); } };
  return (
    <div className="stack"><h1>Scan QR tickets</h1>
      <section className="glass card stack">
        {supported ? (cam ? <><video ref={vref} className="video" muted playsInline /><button className="btn" onClick={stop}>Stop camera</button></> : <button className="btn" onClick={start}>Open camera to scan</button>) : <p className="muted small">This browser cannot scan QR codes. Paste the ticket code below.</p>}
        <div className="field"><label htmlFor="tok">Ticket code</label><input id="tok" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></div>
        <div className="row"><button className="btn primary" disabled={!token || busy} onClick={() => scan('entry')}>Record entry</button><button className="btn" disabled={!token || busy} onClick={() => scan('exit')}>Record exit</button></div>
        {result && <div key={JSON.stringify(result)} className={`scanres ${result.ok ? 'ok' : 'bad'}`} role="status">{result.ok ? <AnimatedCheck size={40} /> : <span className="scanx" aria-hidden="true">!</span>}<strong>{result.message}</strong></div>}
      </section><PendingPayments /></div>
  );
}

function PendingPayments() {
  const toast = useToast(); const p = useAsync(() => unwrap(api.get('/payments/pending')), []);
  const pay = async (id, method) => { try { await api.patch(`/payments/${id}/paid`, { method }); toast('Payment recorded'); p.reload(); } catch (e) { toast(errMsg(e), 'error'); } };
  if (p.loading || p.error || !p.data.length) return null;
  return <section className="glass card table-wrap"><h2>Awaiting payment</h2><table><thead><tr><th>Created</th><th>Amount</th><th>Record payment</th></tr></thead><tbody>{p.data.map((x) => <tr key={x._id}><td>{dt(x.createdAt)}</td><td>{money(x.amount, x.currency)}</td><td className="row">{['cash', 'card_terminal', 'mobile_banking'].map((m) => <button key={m} className="btn sm" onClick={() => pay(x._id, m)}>{m.replace('_', ' ')}</button>)}</td></tr>)}</tbody></table></section>;
}

export function DailyRecords() {
  useTitle('Daily records'); const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const r = useAsync(() => unwrap(api.get('/bookings/daily', { params: { date } })), [date]);
  return <div className="stack"><h1>Daily records</h1><div className="glass card"><label className="small muted" htmlFor="d">Date</label><input id="d" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 220 }} /></div>
    {r.loading ? <Spinner /> : r.error ? <ErrorBox message={r.error} onRetry={r.reload} /> : !r.data.length ? <Empty title="No records for this day" /> : <div className="glass card table-wrap"><table><thead><tr><th>Slot</th><th>Vehicle</th><th>Booked</th><th>Entry</th><th>Exit</th><th>Status</th></tr></thead><tbody>{r.data.map((x) => <tr key={x.id}><td>{x.slotLabel}</td><td>{x.plateMasked}</td><td>{dt(x.start)} - {dt(x.end)}</td><td>{dt(x.entryAt)}</td><td>{dt(x.exitAt)}</td><td><Badge value={x.status} /></td></tr>)}</tbody></table></div>}</div>;
}
