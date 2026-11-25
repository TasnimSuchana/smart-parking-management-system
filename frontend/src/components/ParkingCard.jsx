import { Link } from 'react-router-dom';
import { MapPin, Phone, Mail, Clock, Zap, Shield, Umbrella, Navigation } from 'lucide-react';
import { availabilityLevel, LEVEL_LABEL, openStatus } from '../utils/geo.js';
import { money } from '../utils/format.js';

export const AmenityChips = ({ location: l }) => (
  <div className="row" style={{ gap: '.4rem' }}>
    {l.amenities?.covered && <span className="chip"><Umbrella size={12} /> Covered</span>}
    {l.amenities?.cctv && <span className="chip"><Shield size={12} /> CCTV</span>}
    {l.amenities?.evCharging && <span className="chip"><Zap size={12} /> EV charging</span>}
    {l.open24h !== false && <span className="chip"><Clock size={12} /> 24/7</span>}
  </div>
);

// Used in the list and as the card that opens when a map marker is selected.
export default function ParkingCard({ location: l, price, distance, canBook, selected, onSelect }) {
  const level = availabilityLevel(l), st = openStatus(l), s = l.slots || {};
  const bookable = canBook && (level === 'plenty' || level === 'limited') && st.open;
  return (
    <article className={`glass card stack ${selected ? 'sel-card' : ''}`} aria-label={l.name}>
      <div className="row between"><h3 style={{ margin: 0 }}>{l.name}</h3><span className={`badge lvl-${level}`}>{LEVEL_LABEL[level]}</span></div>
      <p className="muted small row" style={{ margin: 0 }}><MapPin size={14} /> {l.address}, {l.city}{distance != null && <> &middot; <Navigation size={12} /> {distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`}</>}</p>
      <div className="row"><strong>{s.available ?? 0}</strong><span className="muted small">available of {s.total ?? 0} slots</span></div>
      <div className="row between small"><span>{price ? <><strong>{money(price.amount, price.currency)}</strong> <span className="muted">/ hour (car, standard rate)</span></> : <span className="muted">Price shown at booking</span>}</span><span className={st.open ? 'ok-text' : 'err'}>{st.label}</span></div>
      <AmenityChips location={l} />
      {l.phone && <a className="small row" href={`tel:${l.phone.replace(/[^+\d]/g, '')}`}><Phone size={14} /> {l.phone}</a>}
      {l.email && <a className="small row" href={`mailto:${l.email}`}><Mail size={14} /> {l.email}</a>}
      <div className="row">
        <Link className="btn" to={`/locations/${l._id}`}>View details</Link>
        {canBook && (bookable ? <Link className="btn primary" to={`/account/book?location=${l._id}`}>Book now</Link> : <button className="btn" disabled title={!st.open ? 'Closed right now' : 'No free slots'}>{!st.open ? 'Closed' : 'Unavailable'}</button>)}
        {onSelect && <button className="btn sm right" onClick={() => onSelect(l._id)}>Show on map</button>}
      </div>
    </article>
  );
}
