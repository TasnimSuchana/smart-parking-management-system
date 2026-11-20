import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTitle } from '../hooks/useTitle.js';
import { useAsync } from '../hooks/useAsync.js';
import { useSocket } from '../hooks/useSocket.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import api, { unwrap } from '../services/api.js';
import { Spinner, ErrorBox, Modal, Field, Empty } from '../components/UI.jsx';
import SlotGrid from '../components/SlotGrid.jsx';
import AnimatedCheck from '../ui/AnimatedCheck.jsx';
import { dt, errMsg, money, toLocalInput } from '../utils/format.js';

export default function LocationDetail() {
  const { id } = useParams(); const { user } = useAuth(); const nav = useNavigate(); const toast = useToast();
  const loc = useAsync(() => unwrap(api.get(`/parking/locations/${id}`)), [id]);
  const slotsQ = useAsync(() => unwrap(api.get(`/parking/locations/${id}/slots`)), [id]);
  const [slots, setSlots] = useState([]); const [sel, setSel] = useState(null); const [cat, setCat] = useState('');
  useTitle(loc.data?.name || 'Location');
  useEffect(() => { if (slotsQ.data) setSlots(slotsQ.data); }, [slotsQ.data]);
  const { connected } = useSocket({ 'slot:updated': (u) => setSlots((l) => l.map((s) => (s.id === u.slotId ? { ...s, status: u.status } : s))) }, { locationId: id });
  const shown = cat ? slots.filter((s) => s.category === cat) : slots;

  if (loc.loading || slotsQ.loading) return <Spinner />;
  if (loc.error) return <ErrorBox message={loc.error} onRetry={loc.reload} />;
  const l = loc.data;
  return (
    <div style={{ paddingTop: '1.5rem' }} className="stack">
      <div><h1>{l.name}</h1><p className="muted">{l.address}, {l.city}</p>{l.description && <p>{l.description}</p>}</div>
      <div className="grid g4">{[['available', 'Free'], ['reserved', 'Reserved'], ['occupied', 'Occupied'], ['maintenance', 'Maintenance']].map(([k, label]) => <div key={k} className="glass stat"><div className="v">{slots.filter((x) => x.status === k).length}</div><div className="l"><span className={`badge b-${k}`}>{label}</span></div></div>)}</div>
      <section className="glass card">
        <div className="row between"><h2>Slots</h2><span className="small muted"><span className={`dot ${connected ? 'on' : 'off'}`} /> {connected ? 'Live' : 'Reconnecting...'}</span></div>
        <div className="row" style={{ margin: '.5rem 0 1rem' }}><label htmlFor="cat" className="small muted">Category</label>
          <select id="cat" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All</option>{['standard', 'compact', 'ev', 'disabled', 'vip'].map((c) => <option key={c}>{c}</option>)}</select></div>
        {!shown.length ? <Empty title="No slots to show" /> : <SlotGrid slots={shown} selected={sel?.id} onSelect={(s) => (s.status === 'maintenance' ? null : setSel(s))} />}
        <p className="small muted" style={{ marginTop: '.75rem' }}>Select a slot to book it for a future time window. Status shown is live; availability for your chosen time is checked when you book.</p>
      </section>
      <PriceBox locationId={id} />
      {sel && (user ? (user.role === 'user' ? <BookModal slot={sel} location={l} onClose={() => setSel(null)} onDone={() => { toast('Booking confirmed'); nav('/account/bookings'); }} />
        : <Modal title="Admin account" onClose={() => setSel(null)}><p>Booking is available to customer accounts only.</p><button className="btn" onClick={() => setSel(null)}>Close</button></Modal>)
        : <Modal title="Sign in to book" onClose={() => setSel(null)}><p className="muted">You need an account to reserve slot {sel.label}.</p><div className="row"><Link className="btn primary" to="/login" state={{ from: `/locations/${id}` }}>Sign in</Link><Link className="btn" to="/register">Create account</Link></div></Modal>)}
    </div>
  );
}

function PriceBox({ locationId }) {
  const { data } = useAsync(() => unwrap(api.get('/payments/pricing', { params: { locationId } })), [locationId]);
  if (!data) return null;
  return (
    <section className="glass card"><h2>Prices</h2>
      <p className="muted small">Base rate {money(data.baseHourly, data.currency)} per hour (capped at {money(data.dailyRate, data.currency)} per day), multiplied by vehicle type.</p>
      <div className="table-wrap"><table><thead><tr><th>Vehicle</th><th>Hourly</th><th>Daily cap</th></tr></thead><tbody>
        {Object.entries(data.vehicleMultipliers).map(([k, m]) => <tr key={k}><td>{k}</td><td>{money(data.baseHourly * m, data.currency)}</td><td>{money(data.dailyRate * m, data.currency)}</td></tr>)}</tbody></table></div>
      <p className="small muted">Peak hours ({data.peak.map((p) => `${p.startHour}:00-${p.endHour}:00 x${p.multiplier}`).join(', ') || 'none'}) and high occupancy ({data.demand.map((d) => `${d.minOccupancy}%+ x${d.multiplier}`).join(', ') || 'none'}) adjust the price.</p>
    </section>
  );
}

function BookModal({ slot, location, onClose, onDone }) {
  const vehicles = useAsync(() => unwrap(api.get('/vehicles')), []);
  const start0 = new Date(Date.now() + 3600000); start0.setMinutes(0, 0, 0);
  const [start, setStart] = useState(toLocalInput(start0)); const [hours, setHours] = useState(2); const [vehicleId, setVehicleId] = useState('');
  const [quote, setQuote] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const veh = vehicles.data?.find((v) => v.id === (vehicleId || vehicles.data?.[0]?.id));
  const body = () => ({ start: new Date(start).toISOString(), end: new Date(+new Date(start) + hours * 3600000).toISOString() });
  useEffect(() => { if (!veh) return; unwrap(api.post('/payments/quote', { ...body(), locationId: location._id, vehicleType: veh.type })).then(setQuote).catch(() => setQuote(null)); }, [start, hours, veh?.id]); // eslint-disable-line
  const submit = async (e) => { e.preventDefault(); setErr(''); setBusy(true); try { await unwrap(api.post('/bookings', { slotId: slot.id, vehicleId: veh.id, ...body() })); setDone(true); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } };
  return (
    <Modal title={done ? 'Booking confirmed' : `Book slot ${slot.label}`} onClose={done ? onDone : onClose}>
      {done ? (
        <div className="center" style={{ padding: '1rem 0' }} role="status">
          <AnimatedCheck size={72} />
          <h3 style={{ marginTop: '.75rem' }}>Slot {slot.label} is reserved</h3>
          <p className="muted small">{location.name}<br />{dt(body().start)} to {dt(body().end)}</p>
          <button className="btn primary" autoFocus onClick={onDone}>View my bookings & QR ticket</button>
        </div>
      ) : vehicles.loading ? <Spinner /> : !vehicles.data?.length ? <><p className="muted">Add a vehicle first so we can price and verify your booking.</p><Link className="btn primary" to="/account/vehicles">Add a vehicle</Link></> : (
        <form className="stack" onSubmit={submit}>
          <Field label="Vehicle" id="veh"><select id="veh" value={veh?.id} onChange={(e) => setVehicleId(e.target.value)}>{vehicles.data.map((v) => <option key={v.id} value={v.id}>{v.plate} ({v.type})</option>)}</select></Field>
          <Field label="Start" id="start" type="datetime-local" value={start} min={toLocalInput(new Date())} onChange={(e) => setStart(e.target.value)} required />
          <Field label="Duration (hours)" id="dur" type="number" min={1} max={24} value={hours} onChange={(e) => setHours(Math.max(1, Math.min(24, +e.target.value || 1)))} />
          {quote && <div className="glass card small"><strong>{money(quote.total, quote.currency)}</strong> for {quote.hours}h<br />Base {money(quote.baseHourly, quote.currency)}/h x vehicle {quote.vehicleMultiplier}{quote.peakHours ? `, ${quote.peakHours} peak hour(s)` : ''}{quote.dailyCapApplied ? ', daily cap applied' : ''}{quote.demandMultiplier > 1 ? `, demand x${quote.demandMultiplier} (${quote.occupancyPct}% full)` : ''}<br /><span className="muted">{dt(body().start)} to {dt(body().end)}. Payable at exit.</span></div>}
          {err && <p className="err" role="alert">{err}</p>}
          <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Booking...' : 'Confirm booking'}</button></div>
        </form>)}
    </Modal>
  );
}
