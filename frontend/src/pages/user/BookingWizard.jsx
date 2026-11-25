import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTitle } from '../../hooks/useTitle.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useSocket } from '../../hooks/useSocket.js';
import { useToast } from '../../context/ToastContext.jsx';
import api, { unwrap, unwrapPaged } from '../../services/api.js';
import { Spinner, ErrorBox, Empty } from '../../components/UI.jsx';
import BookingStepper from '../../components/BookingStepper.jsx';
import SlotGrid from '../../components/SlotGrid.jsx';
import VehicleSelector from '../../components/VehicleSelector.jsx';
import PriceBreakdown from '../../components/PriceBreakdown.jsx';
import QRCodeTicket from '../../components/QRCodeTicket.jsx';
import { availabilityLevel, openStatus } from '../../utils/geo.js';
import { dt, errMsg, money } from '../../utils/format.js';

const HOUR = 3600000;
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const stamp = (date, time) => new Date(`${date}T${time}:00`);

function timeError({ date, start, end }) {
  if (!date || !start || !end) return 'Choose a date, an entry time and an exit time.';
  const s = stamp(date, start), e = stamp(date, end);
  if (Number.isNaN(+s) || Number.isNaN(+e)) return 'Enter a valid date and time.';
  if (+s < Date.now() - 5 * 60000) return 'You cannot book a time in the past.';
  if (+e <= +s) return 'Exit time must be after entry time.';
  if (+e - +s < HOUR) return 'The minimum booking is 1 hour.';
  if (+e - +s > 24 * HOUR) return 'The maximum booking is 24 hours.';
  if (+s > Date.now() + 30 * 24 * HOUR) return 'You can book up to 30 days ahead.';
  return null;
}

export default function BookingWizard() {
  useTitle('Book parking'); const toast = useToast(); const [sp] = useSearchParams();
  const [step, setStep] = useState(sp.get('location') ? 1 : 0);
  const [locationId, setLocationId] = useState(sp.get('location') || '');
  const first = new Date(Date.now() + HOUR); first.setMinutes(0, 0, 0);
  const [t, setT] = useState({ date: localDate(first), start: localTime(first), end: localTime(new Date(+first + 2 * HOUR)) });
  const [vehicleId, setVehicleId] = useState(''); const [slot, setSlot] = useState(null);
  const [method, setMethod] = useState('pay_at_exit'); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const [result, setResult] = useState(null); // { booking, ticket, payment, payError }

  const locs = useAsync(() => unwrapPaged(api.get('/parking/locations', { params: { limit: 100 } })), []);
  const vehicles = useAsync(() => unwrap(api.get('/vehicles')), []);
  const cfg = useAsync(() => unwrap(api.get('/payments/config')).catch(() => ({ demoPaymentEnabled: false })), []);
  const location = locs.data?.items.find((l) => l._id === locationId);
  const vehicle = vehicles.data?.find((v) => v.id === vehicleId);
  const tErr = timeError(t); const range = useMemo(() => (tErr ? null : { start: stamp(t.date, t.start), end: stamp(t.date, t.end) }), [t, tErr]);

  useEffect(() => { if (vehicles.data?.length && !vehicleId) setVehicleId(vehicles.data[0].id); }, [vehicles.data, vehicleId]);

  const go = (n) => { setMsg(''); setStep(n); };
  return (
    <div className="stack"><h1>Book parking</h1><BookingStepper current={step} />
      {msg && <p className="err" role="alert">{msg}</p>}
      {step === 0 && <StepLocation locs={locs} value={locationId} onPick={(id) => { setLocationId(id); setSlot(null); go(1); }} />}
      {step === 1 && <StepTime t={t} setT={(v) => { setT(v); setSlot(null); }} err={tErr} location={location} onBack={() => go(0)} onNext={() => { const st = location && openStatus(location, range.start); if (st && !st.open) return setMsg(`This location is closed at the chosen time (${st.label}).`); go(2); }} />}
      {step === 2 && <section className="glass card stack"><h2>Choose your vehicle</h2>
        {vehicles.loading ? <Spinner /> : vehicles.error ? <ErrorBox message={vehicles.error} onRetry={vehicles.reload} /> : <VehicleSelector vehicles={vehicles.data} value={vehicleId} onChange={setVehicleId} onAdded={async (v) => { await vehicles.reload(); setVehicleId(v.id); }} />}
        <div className="row"><button className="btn" onClick={() => go(1)}>Back</button><button className="btn primary" disabled={!vehicle} onClick={() => go(3)}>Continue</button></div></section>}
      {step === 3 && <StepSlot locationId={locationId} range={range} slot={slot} setSlot={setSlot} onBack={() => go(2)} onNext={() => go(4)} setMsg={setMsg} />}
      {step === 4 && <StepReview {...{ location, vehicle, slot, range, method, setMethod, cfg: cfg.data, busy }} onBack={() => go(3)}
        onConfirm={async () => {
          setBusy(true); setMsg('');
          try {
            // Re-check availability right before booking; the server re-checks again atomically.
            const av = await unwrap(api.get('/bookings/availability', { params: { locationId, start: range.start.toISOString(), end: range.end.toISOString() } }));
            if (av.bookedSlotIds.includes(slot.id)) { setSlot(null); setMsg('Sorry, this slot was just taken. Please select another slot.'); return go(3); }
            const booking = await unwrap(api.post('/bookings', { slotId: slot.id, vehicleId, start: range.start.toISOString(), end: range.end.toISOString() }));
            let payment = null, payError = '';
            if (method === 'demo') { try { payment = await unwrap(api.post('/payments/demo-pay', { bookingId: booking.id, outcome: 'success' })); } catch (e) { payError = errMsg(e); } }
            const ticket = await unwrap(api.get(`/bookings/${booking.id}/ticket`));
            const pays = await api.get('/payments/me', { params: { bookingId: booking.id } }).then((r) => r.data.data).catch(() => []);
            setResult({ booking, ticket, payment: pays[0] || null, payError }); go(5);
          } catch (e) {
            if (e?.response?.status === 409) { setSlot(null); setMsg('Sorry, this slot was just taken. Please select another slot.'); go(3); } else setMsg(errMsg(e));
          } finally { setBusy(false); }
        }} />}
      {step === 5 && result && <StepDone result={result} setResult={setResult} cfg={cfg.data} toast={toast} />}
    </div>
  );
}

function StepLocation({ locs, value, onPick }) {
  const [q, setQ] = useState('');
  if (locs.loading) return <Spinner label="Loading parking locations..." />; if (locs.error) return <ErrorBox message="Unable to connect to SmartPark. Please try again." onRetry={locs.reload} />;
  const items = locs.data.items.filter((l) => !q || [l.name, l.address, l.city].some((x) => (x || '').toLowerCase().includes(q.toLowerCase())));
  return (
    <section className="stack"><h2>Choose a parking location</h2>
      <input aria-label="Search locations" placeholder="Search by name, area or address" value={q} onChange={(e) => setQ(e.target.value)} />
      {!items.length ? <Empty title="No parking locations available." /> : <div className="grid g3">{items.map((l) => { const lvl = availabilityLevel(l); const ok = lvl === 'plenty' || lvl === 'limited';
        return <button key={l._id} type="button" className={`glass card pick ${value === l._id ? 'sel-card' : ''}`} disabled={!ok} onClick={() => onPick(l._id)} style={{ textAlign: 'left', color: 'inherit', font: 'inherit', opacity: ok ? 1 : 0.5 }}>
          <strong>{l.name}</strong><div className="small muted">{l.address}, {l.city}</div><div className="small" style={{ marginTop: '.4rem' }}><span className={`badge lvl-${lvl}`}>{l.slots?.available ?? 0} free of {l.slots?.total ?? 0}</span></div></button>; })}</div>}
    </section>
  );
}

function StepTime({ t, setT, err, location, onBack, onNext }) {
  const today = localDate(new Date());
  return (
    <section className="glass card stack"><h2>Choose date and time</h2>
      {location && <p className="muted small">{location.name}, {location.address}</p>}
      <div className="grid g3">
        <div className="field"><label htmlFor="d">Date</label><input id="d" type="date" min={today} value={t.date} onChange={(e) => setT({ ...t, date: e.target.value })} /></div>
        <div className="field"><label htmlFor="s">Entry time</label><input id="s" type="time" value={t.start} onChange={(e) => setT({ ...t, start: e.target.value })} /></div>
        <div className="field"><label htmlFor="e">Exit time</label><input id="e" type="time" value={t.end} onChange={(e) => setT({ ...t, end: e.target.value })} /></div>
      </div>
      {err ? <p className="err" role="alert">{err}</p> : <p className="small muted">Entry and exit must be on the same day. Duration 1 to 24 hours.</p>}
      <div className="row"><button className="btn" onClick={onBack}>Back</button><button className="btn primary" disabled={!!err} onClick={onNext}>Continue</button></div></section>
  );
}

function StepSlot({ locationId, range, slot, setSlot, onBack, onNext, setMsg }) {
  const [state, setState] = useState({ loading: true, slots: [], booked: new Set(), error: '' });
  const load = useCallback(async () => {
    try {
      const [slots, av] = await Promise.all([unwrap(api.get(`/parking/locations/${locationId}/slots`)), unwrap(api.get('/bookings/availability', { params: { locationId, start: range.start.toISOString(), end: range.end.toISOString() } }))]);
      setState({ loading: false, slots, booked: new Set(av.bookedSlotIds), error: '' });
    } catch (e) { setState((s) => ({ ...s, loading: false, error: errMsg(e) })); }
  }, [locationId, range]);
  useEffect(() => { load(); }, [load]);
  // Live updates: refetch whenever any slot or booking at this location changes (Socket.IO).
  const { connected } = useSocket({ 'slot:updated': () => load(), 'availability:changed': () => load() }, { locationId });
  // Status for the chosen window: maintenance / booked (reserved) / occupied right now (if the window starts now) / available.
  const view = state.slots.map((s) => {
    let status = 'available';
    if (s.status === 'maintenance') status = 'maintenance'; else if (state.booked.has(s.id)) status = 'reserved'; else if (s.status === 'occupied' && +range.start <= Date.now() + 15 * 60000) status = 'occupied';
    return { ...s, status };
  });
  useEffect(() => { if (slot && view.length && view.find((s) => s.id === slot.id)?.status !== 'available') { setSlot(null); setMsg('Sorry, this slot was just taken. Please select another slot.'); } }, [state]); // eslint-disable-line
  const free = view.filter((s) => s.status === 'available').length;
  return (
    <section className="glass card stack"><div className="row between"><h2>Choose a slot</h2><span className="small muted"><span className={`dot ${connected ? 'on' : 'off'}`} /> {connected ? 'Live' : 'Reconnecting...'}</span></div>
      <p className="small muted">{dt(range.start)} to {dt(range.end)}. Only available slots can be selected.</p>
      {state.loading ? <Spinner label="Loading slots..." /> : state.error ? <ErrorBox message={state.error} onRetry={load} /> : !view.length ? <Empty title="No slots at this location." /> : <>
        {!free && <p className="err" role="alert">No available slots for this time.</p>}
        <SlotGrid slots={view} selected={slot?.id} onSelect={(s) => { if (s.status === 'available') { setSlot(s); setMsg(''); } }} onlyAvailable />
        <p className="small muted">Green = available, yellow = reserved for this time, red = occupied, gray = maintenance, blue = your selection.</p></>}
      <div className="row"><button className="btn" onClick={onBack}>Back</button><button className="btn primary" disabled={!slot} onClick={onNext}>Continue</button></div></section>
  );
}

function StepReview({ location, vehicle, slot, range, method, setMethod, cfg, busy, onBack, onConfirm }) {
  const q = useAsync(() => unwrap(api.post('/payments/quote', { locationId: location._id, vehicleType: vehicle.type, start: range.start.toISOString(), end: range.end.toISOString() })), []);
  return (
    <div className="stack"><section className="glass card"><h2>Review your booking</h2>
      <div className="grid g2 small"><div><span className="muted">Location</span><br />{location.name}</div><div><span className="muted">Slot</span><br />{slot.label} ({slot.category})</div>
        <div><span className="muted">Vehicle</span><br />{vehicle.plate} ({vehicle.type})</div><div><span className="muted">Entry to exit</span><br />{dt(range.start)} to {dt(range.end)}</div></div></section>
      {q.loading ? <Spinner label="Calculating price..." /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : <PriceBreakdown quote={q.data} />}
      <section className="glass card stack"><h3>Payment</h3>
        <label className="row"><input type="radio" name="pm" style={{ width: 'auto', minHeight: 0 }} checked={method === 'pay_at_exit'} onChange={() => setMethod('pay_at_exit')} /> Pay at exit (recorded by the parking admin)</label>
        {cfg?.demoPaymentEnabled && <label className="row"><input type="radio" name="pm" style={{ width: 'auto', minHeight: 0 }} checked={method === 'demo'} onChange={() => setMethod('demo')} /> Test payment: simulated, no real money is charged</label>}
        <p className="small muted">No online payment gateway is connected, so real card or mobile-banking payments are not available yet. The final amount is confirmed at exit (overstay is billed).</p></section>
      <div className="row"><button className="btn" onClick={onBack} disabled={busy}>Back</button><button className="btn primary" onClick={onConfirm} disabled={busy || !q.data}>{busy ? 'Booking...' : `Confirm booking${q.data ? ` (${money(q.data.total, q.data.currency)})` : ''}`}</button></div></div>
  );
}

function StepDone({ result, setResult, cfg, toast }) {
  const { booking: b, ticket, payment, payError } = result; const [busy, setBusy] = useState(false);
  const pay = async () => { setBusy(true); try { const p = await unwrap(api.post('/payments/demo-pay', { bookingId: b.id, outcome: 'success' })); setResult({ ...result, payment: p, payError: '' }); toast('Test payment recorded'); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); } };
  return (
    <section className="glass card stack"><h2>Booking confirmed</h2>
      {payError && <p className="err" role="alert">Payment could not be completed. Your booking is saved and unpaid. {payError}</p>}
      {payment?.status === 'failed' && <p className="err" role="alert">Payment could not be completed.</p>}
      <QRCodeTicket booking={b} token={ticket.token} expiresAt={ticket.expiresAt} payment={payment} onCopied={toast} />
      <div className="row"><Link className="btn primary" to="/account/bookings">View booking</Link><Link className="btn" to="/account/payments">Transactions</Link>
        {cfg?.demoPaymentEnabled && payment && payment.status !== 'paid' && <button className="btn" onClick={pay} disabled={busy}>{busy ? 'Processing...' : 'Pay now (test)'}</button>}
        <Link className="btn" to="/account/book" reloadDocument>Book another</Link></div></section>
  );
}
