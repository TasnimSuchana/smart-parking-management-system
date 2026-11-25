import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTitle } from '../../hooks/useTitle.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useSocket } from '../../hooks/useSocket.js';
import { useToast } from '../../context/ToastContext.jsx';
import api, { unwrap, unwrapPaged } from '../../services/api.js';
import { Spinner, ErrorBox, Empty, Badge, Stat, Field, Confirm, Modal } from '../../components/UI.jsx';
import SlotGrid from '../../components/SlotGrid.jsx';
import PriceBreakdown from '../../components/PriceBreakdown.jsx';
import { RevenueChart, OccupancyChart, BarChart } from '../../components/Charts.jsx';
import { dt, errMsg, money } from '../../utils/format.js';


const isoDate = (d) => d.toISOString().slice(0, 10);
const Section = ({ title, children, aside }) => <section className="glass card stack"><div className="row between"><h2 style={{ margin: 0 }}>{title}</h2>{aside}</div>{children}</section>;
const RankList = ({ rows, left, right, empty = 'No data yet' }) => (!rows?.length ? <Empty title={empty} /> : <div className="stack">{rows.map((r, i) => <div key={i} className="row between"><span>{left(r)}</span><span className="muted">{right(r)}</span></div>)}</div>);

export function AdminOverview() {
  useTitle('Admin overview'); const toast = useToast();
  const [preset, setPreset] = useState(30); const [custom, setCustom] = useState({ from: '', to: '' }); const [period, setPeriod] = useState('daily');
  const range = useMemo(() => (preset === 'custom' && custom.from && custom.to ? custom : { from: isoDate(new Date(Date.now() - preset * 86400000)), to: isoDate(new Date()) }), [preset, custom]);
  const s = useAsync(() => unwrap(api.get('/analytics/summary')), []);
  const o = useAsync(() => unwrap(api.get('/analytics/overview', { params: range })), [range.from, range.to]);
  const r = useAsync(() => unwrap(api.get('/analytics/revenue', { params: { period, ...range } })), [period, range.from, range.to]);
  const pk = useAsync(() => unwrap(api.get('/analytics/peak-hours')), []); const vh = useAsync(() => unwrap(api.get('/analytics/vehicles')), []);
  // Live: any slot/booking/payment event refreshes the numbers (debounced) without a page reload.
  const timer = useRef(null);
  const refresh = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(() => { s.reload(); o.reload(); r.reload(); }, 1500); }, [s.reload, o.reload, r.reload]); // eslint-disable-line
  useEffect(() => () => clearTimeout(timer.current), []);
  const { connected } = useSocket({ alert: (a) => toast(`${a.title}: ${a.message}`, 'error'), 'slot:updated': refresh, 'stats:changed': refresh }, {});
  const qs = `period=${period}&from=${range.from}&to=${range.to}`;
  const rangeErr = preset === 'custom' && custom.from && custom.to && custom.to < custom.from ? 'The end date must be after the start date.' : '';
  if (s.loading && !s.data) return <Spinner label="Loading analytics..." />; if (s.error) return <ErrorBox message={s.error} onRetry={s.reload} />;
  const d = s.data; const ov = o.data;
  return (
    <div className="stack">
      <div className="row between"><h1>Overview</h1><span className="row"><span className="small muted"><span className={`dot ${connected ? 'on' : 'off'}`} /> {connected ? 'Live' : 'Offline'}</span><a className="btn sm" href={`/api/v1/analytics/export?format=csv&${qs}`}>Export CSV</a><a className="btn sm" href={`/api/v1/analytics/export?format=pdf&${qs}`}>Export PDF</a></span></div>
      <div className="glass card row" aria-label="Date range"><div className="tabs">{[7, 30, 90].map((n) => <button key={n} className={`btn sm ${preset === n ? 'on' : ''}`} onClick={() => setPreset(n)}>Last {n} days</button>)}<button className={`btn sm ${preset === 'custom' ? 'on' : ''}`} onClick={() => setPreset('custom')}>Custom</button></div>
        {preset === 'custom' && <><input aria-label="From date" type="date" style={{ width: 'auto' }} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /><input aria-label="To date" type="date" style={{ width: 'auto' }} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></>}
        <span className="small muted right">{range.from} to {range.to} (applies to the sections below and to exports)</span></div>
      {rangeErr && <p className="err" role="alert">{rangeErr}</p>}
      <div className="grid g4"><Stat label="Total slots" value={d.slots?.total ?? '-'} /><Stat label="Available" value={d.slots?.available ?? '-'} /><Stat label="Occupied" value={d.slots?.occupied ?? '-'} /><Stat label="Utilization" value={`${d.utilizationPct}%`} />
        <Stat label="Revenue today" value={money(d.revenue.today)} /><Stat label="Revenue 7 days" value={money(d.revenue.week)} /><Stat label="Revenue 30 days" value={money(d.revenue.month)} /><Stat label="Avg. stay" value={`${d.avgDurationMinutes} min`} hint={`${d.bookings30d} bookings, ${d.cancellations30d} cancelled (30d)`} /></div>
      {o.loading && !ov ? <Spinner label="Loading analytics..." /> : o.error ? <ErrorBox message={o.error} onRetry={o.reload} /> : ov && <>
        <Section title="Bookings"><div className="grid g4"><Stat label="Total bookings" value={ov.bookings.total} /><Stat label="Active (parked)" value={ov.bookings.active} /><Stat label="Completed" value={ov.bookings.completed} /><Stat label="Cancelled" value={ov.bookings.cancelled} hint={`${ov.bookings.cancellationRatePct}% cancellation rate`} /><Stat label="Pending (reserved)" value={ov.bookings.pending} /><Stat label="Expired / no-show" value={ov.bookings.expired} /><Stat label="Avg. booking value" value={money(ov.performance.avgBookingValue)} /><Stat label="Booking conversion" value="n/a" hint="Not tracked: no browse/abandon data" /></div></Section>
        <Section title="Occupancy"><div className="grid g4"><Stat label="Occupied now" value={`${ov.current.occupancyPct}%`} hint={`${ov.current.occupied} occupied, ${ov.current.reserved} reserved`} /><Stat label="Slot utilization (range)" value={`${ov.performance.slotUtilizationPct}%`} /><Stat label="Avg. stay" value={`${ov.performance.avgStayMinutes} min`} /><Stat label="Maintenance slots" value={ov.current.maintenance} /></div>
          <div className="grid g2"><div><h3>By hour of day</h3><OccupancyChart data={ov.occupancy.byHour} /></div><div><h3>By day</h3><OccupancyChart data={ov.occupancy.byDay} xKey="date" /></div></div>
          <div className="grid g2"><div><h3>Most occupied locations</h3><RankList rows={ov.occupancy.mostOccupiedLocations} left={(x) => x.location} right={(x) => `${x.pct}%`} /></div><div><h3>Most occupied slots</h3><RankList rows={ov.occupancy.mostOccupiedSlots} left={(x) => `${x.location} / ${x.slot}`} right={(x) => `${x.slotHours} slot-hours`} /></div></div></Section>
        <Section title="Revenue" aside={<select aria-label="Period" style={{ width: 'auto' }} value={period} onChange={(e) => setPeriod(e.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>}>
          <div className="grid g3"><Stat label="Paid revenue (range)" value={money(ov.revenue.total)} /><Stat label="Pending / failed payments" value={ov.revenue.paymentsByStatus.filter((x) => ['pending', 'failed'].includes(x._id)).reduce((a, x) => a + x.n, 0)} /><Stat label="Paid transactions" value={ov.revenue.byMethod.reduce((a, x) => a + x.transactions, 0)} /></div>
          {r.loading ? <Spinner /> : !r.data?.length ? <Empty title="No revenue recorded in this range" hint="Revenue appears once payments are recorded." /> : <RevenueChart data={r.data} />}
          <div className="grid g2"><div><h3>By location</h3><RankList rows={ov.revenue.byLocation} left={(x) => x.location} right={(x) => `${money(x.revenue)} (${x.transactions})`} /></div><div><h3>By payment method</h3><RankList rows={ov.revenue.byMethod} left={(x) => x.method.replace('_', ' ')} right={(x) => `${money(x.revenue)} (${x.transactions})`} /></div></div></Section>
        <Section title="Top locations">{!ov.topLocations.length ? <Empty title="No locations yet" /> : <div className="table-wrap"><table><thead><tr><th>Location</th><th>Total bookings</th><th>Revenue</th><th>Occupancy</th><th>Avg. stay</th></tr></thead><tbody>{ov.topLocations.map((l) => <tr key={l.locationId}><td>{l.location}</td><td>{l.bookings}</td><td>{money(l.revenue)}</td><td>{l.occupancyPct}%</td><td>{l.avgStayMinutes} min</td></tr>)}</tbody></table></div>}</Section></>}
      <div className="grid g2"><section className="glass card"><h2>Peak hours (30 days)</h2>{pk.data ? <><BarChart data={pk.data} x={(x) => `${x.hour}:00`} y={(x) => x.count} label="Bookings per hour" /><p className="small muted">Bookings starting per hour (count)</p></> : <Spinner />}</section>
        <section className="glass card"><h2>Vehicle statistics (90 days)</h2>{!vh.data?.length ? <Empty title="No data yet" /> : vh.data.map((v) => <div key={v._id} className="row between"><span>{v._id}</span><span className="muted">{v.bookings} bookings &middot; {money(v.value)}</span></div>)}</section></div></div>
  );
}

export function AdminLocations() {
  useTitle('Locations & slots'); const toast = useToast(); const locs = useAsync(() => unwrap(api.get('/parking/admin/locations')), []);
  const blank = { name: '', address: '', city: '', phone: '', email: '', description: '', lat: '', lng: '', covered: false, cctv: false, evCharging: false, open24h: true, opensAt: '', closesAt: '' }; const [f, setF] = useState(blank); const [editing, setEditing] = useState(null); const [del, setDel] = useState(null); const [open, setOpen] = useState(null);
  const save = async (e) => { e.preventDefault(); const num = (v) => (v === '' ? undefined : Number(v)); const body = Object.fromEntries(Object.entries({ name: f.name, address: f.address, city: f.city, phone: f.phone, email: f.email, description: f.description, lat: num(f.lat), lng: num(f.lng), amenities: { covered: f.covered, cctv: f.cctv, evCharging: f.evCharging }, open24h: f.open24h, opensAt: f.open24h ? undefined : f.opensAt, closesAt: f.open24h ? undefined : f.closesAt }).filter(([, v]) => v !== '' && v !== undefined)); try { editing ? await api.put(`/parking/locations/${editing}`, body) : await api.post('/parking/locations', body); toast(editing ? 'Location updated' : 'Location created'); setF(blank); setEditing(null); locs.reload(); } catch (x) { toast(errMsg(x), 'error'); } };
  const remove = async () => { try { await api.delete(`/parking/locations/${del._id}`); toast('Location deleted'); locs.reload(); } catch (x) { toast(errMsg(x), 'error'); } setDel(null); };
  return (
    <div className="stack"><h1>Locations & slots</h1>
      <form className="glass card grid g3" onSubmit={save}><Field label="Name" id="ln" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={100} /><Field label="Address" id="la" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} required maxLength={200} /><Field label="City" id="lc" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} required maxLength={60} />
        <Field label="Phone (optional)" id="lp" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /><Field label="Email (optional)" id="le" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /><Field label="Description (optional)" id="ld" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={600} />
        <Field label="Latitude (for the map)" id="llat" type="number" step="any" min={-90} max={90} value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} /><Field label="Longitude (for the map)" id="llng" type="number" step="any" min={-180} max={180} value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} />
        <div className="filters" style={{ gridColumn: '1/-1' }}>{[['covered', 'Covered'], ['cctv', 'CCTV / security'], ['evCharging', 'EV charging'], ['open24h', 'Open 24/7']].map(([k, v]) => <label key={k} className="chk"><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {v}</label>)}
          {!f.open24h && <><label className="chk">Opens <input type="time" style={{ width: 'auto' }} value={f.opensAt} onChange={(e) => setF({ ...f, opensAt: e.target.value })} required /></label><label className="chk">Closes <input type="time" style={{ width: 'auto' }} value={f.closesAt} onChange={(e) => setF({ ...f, closesAt: e.target.value })} required /></label></>}</div>
        <div className="row"><button className="btn primary">{editing ? 'Save changes' : 'Add location'}</button>{editing && <button type="button" className="btn" onClick={() => { setEditing(null); setF(blank); }}>Cancel</button>}</div></form>
      {locs.loading ? <Spinner /> : locs.error ? <ErrorBox message={locs.error} onRetry={locs.reload} /> : !locs.data.length ? <Empty title="No locations yet" hint="Create your first location above." /> : locs.data.map((l) => (
        <section key={l._id} className="glass card stack"><div className="row between"><div><h3>{l.name}</h3><span className="small muted">{l.address}, {l.city}</span></div>
          <span className="row"><button className="btn sm" onClick={() => setOpen(open === l._id ? null : l._id)}>{open === l._id ? 'Hide' : 'Manage'} slots</button><button className="btn sm" onClick={() => { setEditing(l._id); setF({ ...blank, ...Object.fromEntries(['name', 'address', 'city', 'phone', 'email', 'description'].map((k) => [k, l[k] || ''])), lat: l.lat ?? '', lng: l.lng ?? '', covered: !!l.amenities?.covered, cctv: !!l.amenities?.cctv, evCharging: !!l.amenities?.evCharging, open24h: l.open24h !== false, opensAt: l.opensAt || '', closesAt: l.closesAt || '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button><button className="btn sm danger" onClick={() => setDel(l)}>Delete</button></span></div>
          {open === l._id && <LocationManager location={l} reload={locs.reload} />}</section>))}
      {del && <Confirm title="Delete location?" message={`Delete "${del.name}" and all of its slots? This cannot be undone.`} confirmLabel="Delete location" onConfirm={remove} onClose={() => setDel(null)} />}
    </div>
  );
}

function LocationManager({ location, reload }) {
  const toast = useToast(); const slots = useAsync(() => unwrap(api.get(`/parking/locations/${location._id}/slots`)), [location._id]);
  const [g, setG] = useState({ prefix: 'A', count: 10, category: 'standard' }); const [sel, setSel] = useState(null); const [delSlot, setDelSlot] = useState(null);
  const gen = async (e) => { e.preventDefault(); try { await api.post(`/parking/locations/${location._id}/slots`, { prefix: g.prefix, count: +g.count, category: g.category }); toast('Slots added'); slots.reload(); } catch (x) { toast(errMsg(x), 'error'); } };
  const act = async (fn, msg) => { try { await fn(); toast(msg); slots.reload(); setSel(null); } catch (x) { toast(errMsg(x), 'error'); } };
  return (
    <div className="stack"><form className="row" onSubmit={gen}><input aria-label="Prefix" style={{ width: 80 }} value={g.prefix} maxLength={10} onChange={(e) => setG({ ...g, prefix: e.target.value })} /><input aria-label="Count" type="number" min={1} max={200} style={{ width: 90 }} value={g.count} onChange={(e) => setG({ ...g, count: e.target.value })} /><select aria-label="Category" style={{ width: 'auto' }} value={g.category} onChange={(e) => setG({ ...g, category: e.target.value })}>{['standard', 'compact', 'ev', 'disabled', 'vip'].map((c) => <option key={c}>{c}</option>)}</select><button className="btn sm primary">Add slots</button></form>
      {slots.loading ? <Spinner /> : !slots.data.length ? <Empty title="No slots yet" /> : <SlotGrid slots={slots.data} selected={sel?.id} onSelect={setSel} />}
      {sel && <div className="row"><strong>Slot {sel.label}</strong>{['available', 'maintenance'].map((st) => <button key={st} className="btn sm" onClick={() => act(() => api.patch(`/parking/slots/${sel.id}/status`, { status: st }), `Set to ${st}`)}>{st}</button>)}<button className="btn sm danger" onClick={() => setDelSlot(sel)}>Delete slot</button></div>}
      {delSlot && <Confirm title="Delete slot?" message={`Delete slot ${delSlot.label}?`} confirmLabel="Delete" onConfirm={() => { act(() => api.delete(`/parking/slots/${delSlot.id}`), 'Slot deleted'); setDelSlot(null); }} onClose={() => setDelSlot(null)} />}
    </div>
  );
}

export function AdminUsers() {
  useTitle('Users'); const toast = useToast(); const [q, setQ] = useState(''); const [role, setRole] = useState(''); const [page, setPage] = useState(1);
  const u = useAsync(() => unwrapPaged(api.get('/users', { params: { q: q || undefined, role: role || undefined, page, limit: 20 } })), [q, role, page]);
  const [target, setTarget] = useState(null);
  const toggle = async () => { try { await api.patch(`/users/${target.userId}/status`, { status: target.next }); toast(`Account ${target.next}`); u.reload(); } catch (x) { toast(errMsg(x), 'error'); } setTarget(null); };
  return (
    <div className="stack"><h1>Users</h1>
      <div className="row"><input aria-label="Search users" style={{ flex: 1, minWidth: 200 }} placeholder="Search name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /><select aria-label="Role" style={{ width: 'auto' }} value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}><option value="">All roles</option><option value="user">Users</option><option value="admin">Admins</option></select></div>
      {u.loading ? <Spinner /> : u.error ? <ErrorBox message={u.error} onRetry={u.reload} /> : !u.data.items.length ? <Empty title="No users found" /> : <div className="glass card table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>User ID</th><th>Joined</th><th /></tr></thead><tbody>{u.data.items.map((x) => <tr key={x._id}><td>{x.name}</td><td>{x.email}</td><td><Badge value={x.role === 'user' ? 'info' : x.role} />{' '}{x.role}</td><td><code className="small">{x.userId}</code></td><td>{dt(x.createdAt)}</td><td className="row">{x.role !== 'admin' && <><button className="btn sm danger" onClick={() => setTarget({ ...x, next: 'suspended' })}>Suspend</button><button className="btn sm" onClick={() => setTarget({ ...x, next: 'active' })}>Activate</button></>}</td></tr>)}</tbody></table></div>}
      <div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn sm" disabled={!u.data || page * 20 >= u.data.meta.total} onClick={() => setPage(page + 1)}>Next</button></div>
      {target && <Confirm title={target.next === 'suspended' ? 'Suspend account?' : 'Activate account?'} message={`${target.next === 'suspended' ? 'Suspend' : 'Activate'} ${target.email}?`} confirmLabel={target.next === 'suspended' ? 'Suspend' : 'Activate'} onConfirm={toggle} onClose={() => setTarget(null)} />}
    </div>
  );
}

export function AdminPricing() {
  useTitle('Pricing'); const toast = useToast(); const p = useAsync(() => unwrap(api.get('/payments/pricing')), []); const [txt, setTxt] = useState(null); const [err, setErr] = useState('');
  if (p.loading) return <Spinner />; if (p.error) return <ErrorBox message={p.error} onRetry={p.reload} />;
  const value = txt ?? JSON.stringify(p.data, null, 2);
  const save = async (e) => { e.preventDefault(); setErr(''); let rule; try { rule = JSON.parse(value); } catch { return setErr('That is not valid JSON'); } try { await api.put('/payments/pricing', { locationId: 'default', rule }); toast('Pricing rules saved'); setTxt(null); p.reload(); } catch (x) { setErr(errMsg(x)); } };
  return <div className="stack"><h1>Pricing rules</h1><form className="glass card stack" onSubmit={save}><p className="small muted">Default rules for all locations: base hourly rate, daily cap, vehicle multipliers, peak-hour windows (local hours) and demand tiers (by occupancy %). Every price shown to customers is calculated from these values.</p><label className="skip" htmlFor="rule">Pricing rule JSON</label><textarea id="rule" rows={20} spellCheck={false} style={{ fontFamily: 'ui-monospace,monospace', fontSize: '.85rem' }} value={value} onChange={(e) => setTxt(e.target.value)} />{err && <p className="err" role="alert">{err}</p>}<div className="row"><button className="btn primary">Save pricing</button><button type="button" className="btn" onClick={() => setTxt(null)}>Reset</button></div></form></div>;
}

export function AdminTransactions() {
  useTitle('Transactions'); const toast = useToast(); const [page, setPage] = useState(1); const [status, setStatus] = useState(''); const [method, setMethod] = useState(''); const [q, setQ] = useState(''); const [detail, setDetail] = useState(null);
  const p = useAsync(() => unwrapPaged(api.get('/payments', { params: { page, limit: 20, status: status || undefined, method: method || undefined, q: q || undefined } })), [page, status, method, q]);
  const record = async (x, m) => { try { await api.patch(`/payments/${x.id}/paid`, { method: m }); toast('Payment recorded'); setDetail(null); p.reload(); } catch (e) { toast(errMsg(e), 'error'); } };
  return <div className="stack"><h1>Transactions</h1>
    <div className="glass card row"><div className="tabs" role="tablist">{[['', 'All'], ['pending', 'Pending'], ['paid', 'Paid'], ['failed', 'Failed'], ['refunded', 'Refunded']].map(([k, v]) => <button key={k} role="tab" aria-selected={status === k} className={`btn sm ${status === k ? 'on' : ''}`} onClick={() => { setStatus(k); setPage(1); }}>{v}</button>)}</div>
      <select aria-label="Method" style={{ width: 'auto' }} value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }}><option value="">All methods</option>{['cash', 'card_terminal', 'mobile_banking', 'demo', 'other'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</select>
      <input aria-label="Search transactions" style={{ flex: 1, minWidth: 180 }} placeholder="Search transaction, booking or invoice number" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
    {p.loading && !p.data ? <Spinner label="Loading transactions..." /> : p.error ? <ErrorBox message={p.error} onRetry={p.reload} /> : !p.data.items.length ? <Empty title="No transactions" hint="Nothing matches these filters." /> : <div className="glass card table-wrap"><table><thead><tr><th>Date</th><th>Transaction ID</th><th>Booking</th><th>Amount</th><th>Outstanding</th><th>Method</th><th>Status</th><th /></tr></thead><tbody>{p.data.items.map((x) => <tr key={x.id}><td>{dt(x.createdAt)}</td><td><code className="small">{x.transactionId}</code></td><td>{x.bookingNo}</td><td>{money(x.amount, x.currency)}</td><td>{money(x.outstanding, x.currency)}</td><td>{x.method ? x.method.replace('_', ' ') : '-'}</td><td><Badge value={x.status} /></td><td><button className="btn sm" onClick={() => setDetail(x)}>Details</button></td></tr>)}</tbody></table></div>}
    <div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn sm" disabled={!p.data || page * 20 >= p.data.meta.total} onClick={() => setPage(page + 1)}>Next</button></div>
    {detail && <Modal title="Transaction details" onClose={() => setDetail(null)}><div className="grid g2 small"><div><span className="muted">Transaction ID</span><br />{detail.transactionId}</div><div><span className="muted">Invoice</span><br />{detail.invoiceNo}</div><div><span className="muted">Booking</span><br />{detail.bookingNo}</div><div><span className="muted">Status</span><br /><Badge value={detail.status} /></div><div><span className="muted">Method</span><br />{detail.method || '-'}</div><div><span className="muted">Paid / due</span><br />{money(detail.paidAmount, detail.currency)} / {money(detail.amount, detail.currency)}</div><div><span className="muted">Paid on</span><br />{dt(detail.paidAt)}</div><div><span className="muted">Created</span><br />{dt(detail.createdAt)}</div></div>
      {detail.failureReason && <p className="err small">{detail.failureReason}</p>}{detail.method === 'demo' && <p className="small muted">Simulated test payment: no real money moved.</p>}
      <PriceBreakdown quote={{ lines: detail.breakdown?.lines, total: detail.amount, currency: detail.currency, hours: detail.breakdown?.hours ?? 0, vehicleType: detail.breakdown?.vehicleType ?? '-', vehicleMultiplier: detail.breakdown?.vehicleMultiplier ?? 1 }} />
      {['pending', 'failed'].includes(detail.status) && <div className="row"><strong className="small">Record on-site payment:</strong>{['cash', 'card_terminal', 'mobile_banking'].map((m) => <button key={m} className="btn sm" onClick={() => record(detail, m)}>{m.replace('_', ' ')}</button>)}</div>}
      <div className="row"><a className="btn sm primary" href={`/api/v1/payments/${detail.id}/invoice`} download>Download invoice</a><button className="btn sm" onClick={() => setDetail(null)}>Close</button></div></Modal>}
  </div>;
}

export function AdminSecurity() {
  useTitle('Security logs'); const [severity, setSeverity] = useState(''); const [role, setRole] = useState(''); const [page, setPage] = useState(1);
  const sum = useAsync(() => unwrap(api.get('/audit/summary')), []); const l = useAsync(() => unwrapPaged(api.get('/audit/logs', { params: { severity: severity || undefined, role: role || undefined, page, limit: 25 } })), [severity, role, page]);
  return <div className="stack"><h1>Security & activity</h1>
    {sum.data && <div className="grid g4"><Stat label="Failed logins (24h)" value={sum.data.failedLogins24h} /><Stat label="Account lockouts (24h)" value={sum.data.lockouts24h} /><Stat label="Security alerts (24h)" value={sum.data.alerts24h} /></div>}
    <div className="row"><select aria-label="Severity" style={{ width: 'auto' }} value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }}><option value="">All severities</option><option>info</option><option>warn</option><option>critical</option></select><select aria-label="Actor role" style={{ width: 'auto' }} value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}><option value="">All actors</option><option>admin</option><option>user</option><option>guest</option></select></div>
    {l.loading ? <Spinner /> : l.error ? <ErrorBox message={l.error} onRetry={l.reload} /> : !l.data.items.length ? <Empty title="No log entries" /> : <div className="glass card table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>IP</th><th>Severity</th><th>Details</th></tr></thead><tbody>{l.data.items.map((x) => <tr key={x._id}><td>{dt(x.at)}</td><td>{x.action}</td><td>{x.actorRole}</td><td>{x.ip}</td><td><Badge value={x.severity} /></td><td className="small muted" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.meta ? JSON.stringify(x.meta) : ''}</td></tr>)}</tbody></table></div>}
    <div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn sm" disabled={!l.data || page * 25 >= l.data.meta.total} onClick={() => setPage(page + 1)}>Next</button></div></div>;
}
