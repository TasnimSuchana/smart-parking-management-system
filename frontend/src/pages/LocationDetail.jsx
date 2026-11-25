import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTitle } from '../hooks/useTitle.js';
import { useAsync } from '../hooks/useAsync.js';
import { useSocket } from '../hooks/useSocket.js';
import { useAuth } from '../context/AuthContext.jsx';
import api, { unwrap } from '../services/api.js';
import { Spinner, ErrorBox, Empty } from '../components/UI.jsx';
import SlotGrid from '../components/SlotGrid.jsx';
import { AmenityChips } from '../components/ParkingCard.jsx';
import { availabilityLevel, LEVEL_LABEL, openStatus } from '../utils/geo.js';
import { money } from '../utils/format.js';

export default function LocationDetail() {
  const { id } = useParams(); const { user } = useAuth();
  const loc = useAsync(() => unwrap(api.get(`/parking/locations/${id}`)), [id]);
  const slotsQ = useAsync(() => unwrap(api.get(`/parking/locations/${id}/slots`)), [id]);
  const [slots, setSlots] = useState([]); const [cat, setCat] = useState('');
  useTitle(loc.data?.name || 'Location');
  useEffect(() => { if (slotsQ.data) setSlots(slotsQ.data); }, [slotsQ.data]);
  const { connected } = useSocket({ 'slot:updated': (u) => setSlots((l) => l.map((s) => (s.id === u.slotId ? { ...s, status: u.status } : s))) }, { locationId: id });
  const shown = cat ? slots.filter((s) => s.category === cat) : slots;

  if (loc.loading || slotsQ.loading) return <Spinner label="Loading parking location..." />;
  if (loc.error) return <ErrorBox message={loc.error} onRetry={loc.reload} />;
  const l = loc.data; const st = openStatus(l); const counts = { total: slots.length, available: slots.filter((s) => s.status === 'available').length, maintenance: slots.filter((s) => s.status === 'maintenance').length };
  const level = availabilityLevel({ ...l, slots: counts });
  return (
    <div style={{ paddingTop: '1.5rem' }} className="stack">
      <div className="row between"><div><h1>{l.name}</h1><p className="muted">{l.address}, {l.city}</p>{l.description && <p>{l.description}</p>}<AmenityChips location={l} /></div>
        <div className="stack" style={{ textAlign: 'right' }}><span className={`badge lvl-${level}`}>{LEVEL_LABEL[level]}</span><div className={st.open ? 'ok-text small' : 'err'}>{st.label}</div>
          {user?.role === 'user' && <Link className="btn primary" to={`/account/book?location=${id}`}>Book now</Link>}</div></div>
      <section className="glass card">
        <div className="row between"><h2>Slots (live)</h2><span className="small muted"><span className={`dot ${connected ? 'on' : 'off'}`} /> {connected ? 'Live' : 'Reconnecting...'}</span></div>
        <div className="row" style={{ margin: '.5rem 0 1rem' }}><label htmlFor="cat" className="small muted">Category</label>
          <select id="cat" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All</option>{['standard', 'compact', 'ev', 'disabled', 'vip'].map((c) => <option key={c}>{c}</option>)}</select></div>
        {!shown.length ? <Empty title="No slots to show" /> : <SlotGrid slots={shown} />}
        <p className="small muted" style={{ marginTop: '.75rem' }}>This shows each slot's status right now. When you book, availability for your chosen time window is checked.</p>
      </section>
      <PriceBox locationId={id} />
    </div>
  );
}

function PriceBox({ locationId }) {
  const { data } = useAsync(() => unwrap(api.get('/payments/pricing', { params: { locationId } })), [locationId]);
  if (!data) return null;
  return (
    <section className="glass card"><h2>Prices</h2>
      <p className="muted small">Base rate {money(data.baseHourly, data.currency)} per hour (capped at {money(data.dailyRate, data.currency)} per day), multiplied by vehicle type.{data.serviceFee > 0 ? ` A service fee of ${money(data.serviceFee, data.currency)} applies per booking.` : ''}{data.discountPercent > 0 ? ` ${data.discountPercent}% discount applied.` : ''}</p>
      <div className="table-wrap"><table><thead><tr><th>Vehicle</th><th>Hourly</th><th>Daily cap</th></tr></thead><tbody>
        {Object.entries(data.vehicleMultipliers).map(([k, m]) => <tr key={k}><td>{k}</td><td>{money(data.baseHourly * m, data.currency)}</td><td>{money(data.dailyRate * m, data.currency)}</td></tr>)}</tbody></table></div>
      <p className="small muted">Peak hours ({data.peak.map((p) => `${p.startHour}:00-${p.endHour}:00 x${p.multiplier}`).join(', ') || 'none'}) and high occupancy ({data.demand.map((d) => `${d.minOccupancy}%+ x${d.multiplier}`).join(', ') || 'none'}) adjust the price.</p>
    </section>
  );
}
