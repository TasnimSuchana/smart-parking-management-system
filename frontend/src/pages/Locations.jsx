import { useEffect, useMemo, useState } from 'react';
import { Navigation, RefreshCw } from 'lucide-react';
import { useTitle } from '../hooks/useTitle.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import api, { unwrap, unwrapPaged } from '../services/api.js';
import { Spinner, Empty, ErrorBox } from '../components/UI.jsx';
import ParkingCard from '../components/ParkingCard.jsx';
import ParkingMap from '../components/ParkingMap.jsx';
import { availabilityLevel, distanceKm, hasCoords, hourlyPrice, openStatus } from '../utils/geo.js';

const SORTS = [['recommended', 'Recommended'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['availability', 'Availability'], ['nearest', 'Nearest (needs your location)']];

export default function Locations() {
  useTitle('Find parking'); const { user } = useAuth();
  const locs = useAsync(() => unwrapPaged(api.get('/parking/locations', { params: { limit: 100 } })), []);
  const pricing = useAsync(() => unwrap(api.get('/payments/pricing/summary')).catch(() => null), []);
  const [f, setF] = useState({ q: '', available: false, covered: false, cctv: false, ev: false, h24: false, maxPrice: '' });
  const [sort, setSort] = useState('recommended'); const [sel, setSel] = useState(null); const [pos, setPos] = useState(null); const [geoErr, setGeoErr] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => { const t = setInterval(() => locs.reload(), 30000); return () => clearInterval(t); }, []); // eslint-disable-line -- keep availability fresh

  const locate = () => { setGeoErr(''); if (!navigator.geolocation) return setGeoErr('Your browser does not support location.');
    navigator.geolocation.getCurrentPosition((p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setSort((s) => (s === 'recommended' ? 'nearest' : s)); }, () => setGeoErr('Location permission was denied.'), { timeout: 8000 }); };

  const rows = useMemo(() => {
    const list = (locs.data?.items || []).map((l) => ({ l, price: hourlyPrice(l, pricing.data), dist: pos && hasCoords(l) ? distanceKm(pos, l) : null }));
    const q = f.q.trim().toLowerCase(); const max = Number(f.maxPrice);
    const out = list.filter(({ l, price }) => (!q || [l.name, l.address, l.city].some((x) => (x || '').toLowerCase().includes(q)))
      && (!f.available || ['plenty', 'limited'].includes(availabilityLevel(l)))
      && (!f.covered || l.amenities?.covered) && (!f.cctv || l.amenities?.cctv) && (!f.ev || l.amenities?.evCharging) && (!f.h24 || l.open24h !== false)
      && (!max || !price || price.amount <= max));
    const score = ({ l, price, dist }) => { const lvl = availabilityLevel(l); const base = { plenty: 3, limited: 2, full: 0, unavailable: -1 }[lvl] * 100 + (openStatus(l).open ? 50 : 0) - (price?.amount || 0) / 10 - (dist || 0); return base; };
    const cmp = { recommended: (a, b) => score(b) - score(a), price_asc: (a, b) => (a.price?.amount ?? 1e9) - (b.price?.amount ?? 1e9), price_desc: (a, b) => (b.price?.amount ?? -1) - (a.price?.amount ?? -1),
      availability: (a, b) => (b.l.slots?.available || 0) - (a.l.slots?.available || 0), nearest: (a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9) }[sort];
    return out.sort(cmp);
  }, [locs.data, pricing.data, f, sort, pos]);

  const canBook = user?.role === 'user'; const selected = rows.find((r) => r.l._id === sel);
  const maxRate = Math.ceil(Math.max(0, ...(locs.data?.items || []).map((l) => hourlyPrice(l, pricing.data)?.amount || 0)));
  return (
    <div style={{ paddingTop: '1.5rem' }} className="stack">
      <div className="row between"><h1>Find parking</h1><span className="row"><button className="btn sm" onClick={locate}><Navigation size={14} /> Use my location</button><button className="btn sm" onClick={() => locs.reload()} aria-label="Refresh availability"><RefreshCw size={14} /></button></span></div>
      {geoErr && <p className="err" role="alert">{geoErr}</p>}
      <section className="glass card stack" aria-label="Search and filters">
        <div className="row"><label htmlFor="q" className="skip">Search by name, area or address</label>
          <input id="q" style={{ flex: 1, minWidth: 200 }} placeholder="Search by name, area or address" value={f.q} onChange={(e) => set('q', e.target.value)} maxLength={60} />
          <label htmlFor="sort" className="skip">Sort</label><select id="sort" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([k, v]) => <option key={k} value={k} disabled={k === 'nearest' && !pos}>{v}</option>)}</select></div>
        <div className="filters">
          {[['available', 'Available now'], ['covered', 'Covered'], ['cctv', 'CCTV / security'], ['ev', 'EV charging'], ['h24', '24/7']].map(([k, v]) => <label key={k} className="chk"><input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} /> {v}</label>)}
          {maxRate > 0 && <label className="chk">Max price / hour <input type="number" min={0} style={{ width: 90 }} placeholder={`${maxRate}`} value={f.maxPrice} onChange={(e) => set('maxPrice', e.target.value)} /></label>}
          <button className="btn sm" onClick={() => { setF({ q: '', available: false, covered: false, cctv: false, ev: false, h24: false, maxPrice: '' }); setSort('recommended'); }}>Clear</button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Rating filters are not shown because no rating data is collected. Prices shown are the standard hourly car rate; peak and demand pricing are applied when you book.</p>
      </section>
      {locs.loading && !locs.data ? <Spinner label="Loading parking locations..." /> : locs.error ? <ErrorBox message="Unable to connect to SmartPark. Please try again." onRetry={locs.reload} /> : !locs.data.items.length ? <Empty title="No parking locations available." /> : (
        <>
          <section className="glass card stack"><h2>Map</h2><ParkingMap locations={rows.map((r) => r.l)} selectedId={sel} onSelect={setSel} userPos={pos} />
            {selected && <ParkingCard location={selected.l} price={selected.price} distance={selected.dist} canBook={canBook} selected />}</section>
          <section aria-label="Results"><p className="small muted">{rows.length} of {locs.data.meta.total} locations</p>
            {!rows.length ? <Empty title="No locations match your filters." hint="Try removing a filter." /> : <div className="grid g3">{rows.map(({ l, price, dist }) => <ParkingCard key={l._id} location={l} price={price} distance={dist} canBook={canBook} selected={sel === l._id} onSelect={hasCoords(l) ? setSel : undefined} />)}</div>}</section>
        </>)}
    </div>
  );
}
