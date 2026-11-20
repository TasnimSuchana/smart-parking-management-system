import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapPin, Phone, Mail } from 'lucide-react';
import { useTitle } from '../hooks/useTitle.js';
import { useAsync } from '../hooks/useAsync.js';
import api, { unwrapPaged } from '../services/api.js';
import { Empty, ErrorBox } from '../components/UI.jsx';
import Skeleton from '../ui/Skeleton.jsx';
import LocationMap from '../components/LocationMap.jsx';

const SORTS = { default: 'Default', available: 'Most available', name: 'Name (A-Z)' };

function CardSkeletons() {
  return <div className="grid g3" role="status" aria-label="Loading locations">{[0, 1, 2].map((i) => <div key={i} className="glass skel-card"><Skeleton height={20} width="60%" /><Skeleton height={14} /><Skeleton height={6} /><Skeleton height={40} /></div>)}</div>;
}

export default function Locations() {
  useTitle('Find parking');
  const [q, setQ] = useState(''); const [applied, setApplied] = useState(''); const [page, setPage] = useState(1);
  const nav = useNavigate(); const [activeId, setActiveId] = useState(null); const [view, setView] = useState('list');
  const [onlyAvail, setOnlyAvail] = useState(false); const [sort, setSort] = useState('default');
  const { data, loading, error, reload } = useAsync(() => unwrapPaged(api.get('/parking/locations', { params: { q: applied || undefined, page, limit: 12 } })), [applied, page]);
  const pick = (id) => { setActiveId(id); document.getElementById(`loc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
  const items = useMemo(() => {
    let list = data?.items || [];
    if (onlyAvail) list = list.filter((l) => l.slots.available > 0);
    if (sort === 'available') list = [...list].sort((a, b) => b.slots.available - a.slots.available);
    if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [data, onlyAvail, sort]);
  return (
    <div style={{ paddingTop: '1.5rem' }}>
      <h1>Find parking</h1>
      <form className="row" role="search" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(q.trim()); }} style={{ margin: '1rem 0 0' }}>
        <label htmlFor="q" className="skip">Search locations</label>
        <input id="q" style={{ flex: 1, minWidth: 200 }} placeholder="Search by name, area or city" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} />
        <button className="btn primary">Search</button>
      </form>
      <div className="filters">
        <label className="toggle"><input type="checkbox" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} /> Only with free slots</label>
        <label htmlFor="sort" className="skip">Sort</label>
        <select id="sort" value={sort} onChange={(e) => setSort(e.target.value)}>{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <div className="viewtoggle" role="group" aria-label="View"><button className={`btn sm ${view === 'list' ? 'primary' : ''}`} onClick={() => setView('list')}>List</button><button className={`btn sm ${view === 'map' ? 'primary' : ''}`} onClick={() => setView('map')}>Map</button></div>
      <div className={`finder ${view === 'map' ? 'show-map' : ''}`}>
        <div className="listpane">
          {loading ? <CardSkeletons /> : error ? <ErrorBox message={error} onRetry={reload} /> : !items.length ? <Empty title="No locations found" hint="Try a different search term or turn off the filters." /> : (
            <div className="grid g2">{items.map((l) => {
              const pct = l.slots.total ? Math.round(((l.slots.total - l.slots.available) / l.slots.total) * 100) : 0;
              return (
                <article key={l._id} id={`loc-${l._id}`} className={`glass card stack ${activeId === l._id ? 'active' : ''}`} onMouseEnter={() => setActiveId(l._id)}>
                  <h3>{l.name}</h3>
                  <p className="muted small row"><MapPin size={14} /> {l.address}, {l.city}</p>
                  <div className="row"><span className={`badge ${l.slots.available ? 'b-available' : 'b-occupied'}`}>{l.slots.available ? `${l.slots.available} available` : 'Full'}</span><span className="small muted">of {l.slots.total} slots</span></div>
                  <div className={`occ ${pct >= 85 ? 'high' : pct >= 60 ? 'mid' : ''}`} role="img" aria-label={`${pct}% occupied`}><i style={{ width: `${pct}%` }} /></div>
                  {l.phone && <a className="small row" href={`tel:${l.phone.replace(/[^+\d]/g, '')}`}><Phone size={14} /> {l.phone}</a>}
                  {l.email && <a className="small row" href={`mailto:${l.email}`}><Mail size={14} /> {l.email}</a>}
                  <Link className="btn primary" to={`/locations/${l._id}`}>View slots & prices</Link>
                </article>);
            })}</div>
          )}
        </div>
        <div className="mappane">
          <LocationMap items={items} activeId={activeId} onSelect={pick} onOpen={(id) => nav(`/locations/${id}`)} visible={view === 'map' || window.innerWidth > 900} />
          {items.length > 0 && items.some((l) => !Number.isFinite(l.lat) || !Number.isFinite(l.lng)) && <p className="small muted" style={{ marginTop: '.5rem' }}>Some locations have no map position yet. An admin can add latitude/longitude in Locations & slots.</p>}
        </div>
      </div>
      {data && data.meta.total > data.meta.limit && (
        <div className="row" style={{ justifyContent: 'center', marginTop: '1rem' }}>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="small muted">Page {page} of {Math.ceil(data.meta.total / data.meta.limit)}</span>
          <button className="btn sm" disabled={page * data.meta.limit >= data.meta.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>)}
    </div>
  );
}
