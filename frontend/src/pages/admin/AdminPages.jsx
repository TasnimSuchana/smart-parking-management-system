import { useState } from 'react';
import { useTitle } from '../../hooks/useTitle.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useSocket } from '../../hooks/useSocket.js';
import { useToast } from '../../context/ToastContext.jsx';
import api, { unwrap, unwrapPaged } from '../../services/api.js';
import { Spinner, ErrorBox, Empty, Badge, Stat, Field, Confirm } from '../../components/UI.jsx';
import SlotGrid from '../../components/SlotGrid.jsx';
import { BarChart, Gauge, StackBar } from '../../components/Charts.jsx';
import MapPicker from '../../components/MapPicker.jsx';
import { dt, errMsg, money } from '../../utils/format.js';

const Bars = (p) => <BarChart {...p} />;

export function AdminOverview() {
  useTitle('Admin overview'); const toast = useToast(); const [period, setPeriod] = useState('daily');
  const s = useAsync(() => unwrap(api.get('/analytics/summary')), []); const r = useAsync(() => unwrap(api.get('/analytics/revenue', { params: { period } })), [period]);
  const pk = useAsync(() => unwrap(api.get('/analytics/peak-hours')), []); const vh = useAsync(() => unwrap(api.get('/analytics/vehicles')), []);
  useSocket({ alert: (a) => toast(`${a.title}: ${a.message}`, 'error'), 'slot:updated': () => s.reload() }, {});
  if (s.loading) return <Spinner />; if (s.error) return <ErrorBox message={s.error} onRetry={s.reload} />;
  const d = s.data;
  return (
    <div className="stack"><div className="row between"><h1>Overview</h1><span className="row"><a className="btn sm" href={`/api/v1/analytics/export?format=csv&period=${period}`}>Export CSV</a><a className="btn sm" href={`/api/v1/analytics/export?format=pdf&period=${period}`}>Export PDF</a></span></div>
      <div className="grid g4"><Stat label="Total slots" value={d.slots?.total ?? '-'} /><Stat label="Available" value={d.slots?.available ?? '-'} /><Stat label="Occupied" value={d.slots?.occupied ?? '-'} /><div className="glass stat row" style={{ flexWrap: 'nowrap' }}><Gauge pct={d.utilizationPct} size={72} /><div><div className="l">Utilization</div><div className="small muted">of bookable slots</div></div></div>
        <Stat label="Revenue today" value={money(d.revenue.today)} /><Stat label="Revenue 7 days" value={money(d.revenue.week)} /><Stat label="Revenue 30 days" value={money(d.revenue.month)} /><Stat label="Avg. stay" value={`${d.avgDurationMinutes} min`} hint={`${d.bookings30d} bookings, ${d.cancellations30d} cancelled (30d)`} /></div>
      <section className="glass card"><h2>Slot status</h2><StackBar parts={[{ label: 'Available', value: d.slots?.available ?? 0, color: 'var(--ok)' }, { label: 'Reserved', value: d.slots?.reserved ?? 0, color: 'var(--warn)' }, { label: 'Occupied', value: d.slots?.occupied ?? 0, color: 'var(--bad)' }, { label: 'Maintenance', value: d.slots?.maintenance ?? 0, color: 'var(--muted)' }]} /></section>
      <section className="glass card"><div className="row between"><h2>Revenue</h2><select aria-label="Period" style={{ width: 'auto' }} value={period} onChange={(e) => setPeriod(e.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
        {r.loading ? <Spinner /> : !r.data?.length ? <Empty title="No revenue recorded yet" hint="Revenue appears once payments are recorded." /> : <><Bars data={r.data} label={(x) => x.period} value={(x) => x.revenue} format={(n) => money(n)} height={180} /><p className="small muted">{r.data[0].period} to {r.data[r.data.length - 1].period}</p></>}</section>
      <div className="grid g2"><section className="glass card"><h2>Peak hours (30 days)</h2>{pk.data ? <><Bars data={pk.data} label={(x) => `${x.hour}:00`} value={(x) => x.count} highlightMax /><p className="small muted">0:00 to 23:00, local time</p></> : <Spinner />}</section>
        <section className="glass card"><h2>Vehicle statistics (90 days)</h2>{!vh.data?.length ? <Empty title="No data yet" /> : vh.data.map((v) => <div key={v._id} className="stack" style={{ marginBottom: '.6rem' }}><div className="row between"><span>{v._id}</span><span className="muted small">{v.bookings} bookings &middot; {money(v.value)}</span></div><div className="occ"><i style={{ width: `${(v.bookings / Math.max(1, ...vh.data.map((z) => z.bookings))) * 100}%` }} /></div></div>)}</section></div></div>
  );
}

export function AdminLocations() {
  useTitle('Locations & slots'); const toast = useToast(); const locs = useAsync(() => unwrap(api.get('/parking/admin/locations')), []);
  const blank = { name: '', address: '', city: '', phone: '', email: '', description: '', lat: '', lng: '' }; const [f, setF] = useState(blank); const [editing, setEditing] = useState(null); const [del, setDel] = useState(null); const [open, setOpen] = useState(null); const [picking, setPicking] = useState(false);
  const save = async (e) => { e.preventDefault(); const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')); for (const k of ['lat', 'lng']) if (k in body) body[k] = Number(body[k]); try { editing ? await api.put(`/parking/locations/${editing}`, body) : await api.post('/parking/locations', body); toast(editing ? 'Location updated' : 'Location created'); setF(blank); setEditing(null); locs.reload(); } catch (x) { toast(errMsg(x), 'error'); } };
  const remove = async () => { try { await api.delete(`/parking/locations/${del._id}`); toast('Location deleted'); locs.reload(); } catch (x) { toast(errMsg(x), 'error'); } setDel(null); };
  return (
    <div className="stack"><h1>Locations & slots</h1>
      <form className="glass card grid g3" onSubmit={save}><Field label="Name" id="ln" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={100} /><Field label="Address" id="la" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} required maxLength={200} /><Field label="City" id="lc" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} required maxLength={60} />
        <Field label="Phone (optional)" id="lp" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /><Field label="Email (optional)" id="le" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /><Field label="Description (optional)" id="ld" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={600} />
        <Field label="Latitude (optional, for map)" id="llat" type="number" step="any" min={-90} max={90} value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} /><Field label="Longitude (optional, for map)" id="llng" type="number" step="any" min={-180} max={180} value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} />
        <div className="row" style={{ alignSelf: 'end' }}><button type="button" className="btn" onClick={() => setPicking(true)}>Pick on map</button></div>
        {picking && <MapPicker lat={f.lat} lng={f.lng} onClose={() => setPicking(false)} onConfirm={(la, ln) => { setF({ ...f, lat: la.toFixed(6), lng: ln.toFixed(6) }); setPicking(false); }} />}
        <div className="row"><button className="btn primary">{editing ? 'Save changes' : 'Add location'}</button>{editing && <button type="button" className="btn" onClick={() => { setEditing(null); setF(blank); }}>Cancel</button>}</div></form>
      {locs.loading ? <Spinner /> : locs.error ? <ErrorBox message={locs.error} onRetry={locs.reload} /> : !locs.data.length ? <Empty title="No locations yet" hint="Create your first location above." /> : locs.data.map((l) => (
        <section key={l._id} className="glass card stack"><div className="row between"><div><h3>{l.name}</h3><span className="small muted">{l.address}, {l.city}</span></div>
          <span className="row"><button className="btn sm" onClick={() => setOpen(open === l._id ? null : l._id)}>{open === l._id ? 'Hide' : 'Manage'} slots</button><button className="btn sm" onClick={() => { setEditing(l._id); setF({ ...blank, ...Object.fromEntries(['name', 'address', 'city', 'phone', 'email', 'description', 'lat', 'lng'].map((k) => [k, l[k] ?? ''])) }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button><button className="btn sm danger" onClick={() => setDel(l)}>Delete</button></span></div>
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
      {u.loading ? <Spinner /> : u.error ? <ErrorBox message={u.error} onRetry={u.reload} /> : !u.data.items.length ? <Empty title="No users found" /> : <div className="glass card table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>User ID</th><th>Joined</th><th /></tr></thead><tbody>{u.data.items.map((x) => <tr key={x._id}><td><span className="row" style={{ flexWrap: 'nowrap', gap: '.5rem' }}><span className="avatar" aria-hidden="true">{(x.name || '?').trim().charAt(0).toUpperCase()}</span>{x.name}</span></td><td>{x.email}</td><td><Badge value={x.role === 'user' ? 'info' : x.role} />{' '}{x.role}</td><td><code className="small">{x.userId}</code></td><td>{dt(x.createdAt)}</td><td className="row">{x.status && x.status !== 'active' && <Badge value={x.status} />}{x.role !== 'admin' && (x.status === 'suspended' ? <button className="btn sm" onClick={() => setTarget({ ...x, next: 'active' })}>Activate</button> : x.status === 'active' ? <button className="btn sm danger" onClick={() => setTarget({ ...x, next: 'suspended' })}>Suspend</button> : <><button className="btn sm danger" onClick={() => setTarget({ ...x, next: 'suspended' })}>Suspend</button><button className="btn sm" onClick={() => setTarget({ ...x, next: 'active' })}>Activate</button></>)}</td></tr>)}</tbody></table></div>}
      <div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn sm" disabled={!u.data || page * 20 >= u.data.meta.total} onClick={() => setPage(page + 1)}>Next</button></div>
      {target && <Confirm title={target.next === 'suspended' ? 'Suspend account?' : 'Activate account?'} message={`${target.next === 'suspended' ? 'Suspend' : 'Activate'} ${target.email}?`} confirmLabel={target.next === 'suspended' ? 'Suspend' : 'Activate'} onConfirm={toggle} onClose={() => setTarget(null)} />}
    </div>
  );
}

export function AdminPricing() {
  useTitle('Pricing'); const toast = useToast(); const p = useAsync(() => unwrap(api.get('/payments/pricing')), []);
  const [rule, setRule] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (p.loading) return <Spinner />; if (p.error) return <ErrorBox message={p.error} onRetry={p.reload} />;
  const r = rule ?? p.data;
  const edit = (fn) => { const c = JSON.parse(JSON.stringify(r)); fn(c); setRule(c); };
  const num = (v) => (v === '' ? '' : Number(v));
  const save = async (e) => { e.preventDefault(); setErr(''); setBusy(true); try { await api.put('/payments/pricing', { locationId: 'default', rule: r }); toast('Pricing rules saved'); setRule(null); p.reload(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } };
  const N = (props) => <input type="number" step="any" min="0" {...props} />;
  return (
    <div className="stack"><h1>Pricing rules</h1>
      <form className="stack" onSubmit={save}>
        <p className="small muted">Default rules for all locations. Every price shown to customers is calculated from these values.</p>
        <section className="glass card stack"><h2>Base rates</h2>
          <div className="grid g3">
            <Field label={`Base hourly rate (${r.currency || 'BDT'})`} id="pr-b"><N id="pr-b" value={r.baseHourly ?? ''} onChange={(e) => edit((c) => { c.baseHourly = num(e.target.value); })} /></Field>
            <Field label="Daily cap" id="pr-d"><N id="pr-d" value={r.dailyRate ?? ''} onChange={(e) => edit((c) => { c.dailyRate = num(e.target.value); })} /></Field>
          </div></section>
        <section className="glass card stack"><h2>Vehicle multipliers</h2>
          <div className="grid g4">{Object.entries(r.vehicleMultipliers || {}).map(([k, m]) => <Field key={k} label={k} id={`pr-v-${k}`}><N id={`pr-v-${k}`} value={m} onChange={(e) => edit((c) => { c.vehicleMultipliers[k] = num(e.target.value); })} /></Field>)}</div></section>
        <section className="glass card stack"><div className="row between"><h2>Peak hours</h2><button type="button" className="btn sm" onClick={() => edit((c) => { (c.peak = c.peak || []).push({ startHour: 17, endHour: 20, multiplier: 1.2 }); })}>Add window</button></div>
          {!(r.peak || []).length ? <p className="small muted">No peak windows. Prices stay flat across the day.</p> : (r.peak || []).map((w, i) => (
            <div key={i} className="row" style={{ alignItems: 'end' }}>
              <Field label="From (hour)" id={`pk-s-${i}`}><N id={`pk-s-${i}`} max="24" value={w.startHour} onChange={(e) => edit((c) => { c.peak[i].startHour = num(e.target.value); })} /></Field>
              <Field label="To (hour)" id={`pk-e-${i}`}><N id={`pk-e-${i}`} max="24" value={w.endHour} onChange={(e) => edit((c) => { c.peak[i].endHour = num(e.target.value); })} /></Field>
              <Field label="Multiplier" id={`pk-m-${i}`}><N id={`pk-m-${i}`} value={w.multiplier} onChange={(e) => edit((c) => { c.peak[i].multiplier = num(e.target.value); })} /></Field>
              <button type="button" className="btn sm danger" onClick={() => edit((c) => { c.peak.splice(i, 1); })}>Remove</button>
            </div>))}</section>
        <section className="glass card stack"><div className="row between"><h2>Demand tiers</h2><button type="button" className="btn sm" onClick={() => edit((c) => { (c.demand = c.demand || []).push({ minOccupancy: 80, multiplier: 1.2 }); })}>Add tier</button></div>
          {!(r.demand || []).length ? <p className="small muted">No demand tiers. Occupancy does not change the price.</p> : (r.demand || []).map((t, i) => (
            <div key={i} className="row" style={{ alignItems: 'end' }}>
              <Field label="Occupancy from (%)" id={`dm-o-${i}`}><N id={`dm-o-${i}`} max="100" value={t.minOccupancy} onChange={(e) => edit((c) => { c.demand[i].minOccupancy = num(e.target.value); })} /></Field>
              <Field label="Multiplier" id={`dm-m-${i}`}><N id={`dm-m-${i}`} value={t.multiplier} onChange={(e) => edit((c) => { c.demand[i].multiplier = num(e.target.value); })} /></Field>
              <button type="button" className="btn sm danger" onClick={() => edit((c) => { c.demand.splice(i, 1); })}>Remove</button>
            </div>))}</section>
        <details className="glass card"><summary>Advanced: view raw rule (JSON)</summary><pre className="small" style={{ overflow: 'auto', margin: '.75rem 0 0' }}>{JSON.stringify(r, null, 2)}</pre></details>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="row"><button className="btn primary" disabled={busy || !rule}>{busy ? 'Saving...' : 'Save pricing'}</button><button type="button" className="btn" disabled={!rule} onClick={() => setRule(null)}>Reset changes</button></div>
      </form></div>
  );
}

export function AdminTransactions() {
  useTitle('Transactions'); const [page, setPage] = useState(1); const [status, setStatus] = useState('');
  const toast = useToast(); const pay = async (id, method) => { try { await api.patch(`/payments/${id}/paid`, { method }); toast('Payment recorded'); p.reload(); } catch (e) { toast(errMsg(e), 'error'); } };
  const p = useAsync(() => unwrapPaged(api.get('/payments', { params: { page, limit: 20, status: status || undefined } })), [page, status]);
  return <div className="stack"><h1>Transactions</h1><select aria-label="Status" style={{ width: 'auto' }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option><option value="pending">Pending</option><option value="paid">Paid</option></select>
    {p.loading ? <Spinner /> : p.error ? <ErrorBox message={p.error} onRetry={p.reload} /> : !p.data.items.length ? <Empty title="No transactions" /> : <div className="glass card table-wrap"><table><thead><tr><th>Date</th><th>Booking</th><th>Amount</th><th>Status</th><th>Method</th><th /></tr></thead><tbody>{p.data.items.map((x) => <tr key={x._id}><td>{dt(x.createdAt)}</td><td><code className="small">{x.bookingId}</code></td><td>{money(x.amount, x.currency)}</td><td><Badge value={x.status} /></td><td>{x.method || '-'}</td><td className="row">{x.status === 'pending' && ['cash', 'card_terminal', 'mobile_banking'].map((m) => <button key={m} className="btn sm" onClick={() => pay(x._id, m)}>{m.replace('_', ' ')}</button>)}</td></tr>)}</tbody></table></div>}
    <div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn sm" disabled={!p.data || page * 20 >= p.data.meta.total} onClick={() => setPage(page + 1)}>Next</button></div></div>;
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
