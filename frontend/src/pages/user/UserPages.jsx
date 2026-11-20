import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Car, Bike, Truck, Zap, QrCode, Plus, Search } from 'lucide-react';
import { useTitle } from '../../hooks/useTitle.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useSocket } from '../../hooks/useSocket.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import api, { unwrap, unwrapPaged } from '../../services/api.js';
import { Spinner, ErrorBox, Empty, Badge, Stat, Field, Modal, Confirm } from '../../components/UI.jsx';
import { dt, errMsg, money } from '../../utils/format.js';

export function UserOverview() {
  useTitle('My dashboard'); const { user } = useAuth(); const toast = useToast();
  const [ticket, setTicket] = useState(null);
  const showTicket = async (x) => { try { setTicket({ ...x, ...(await unwrap(api.get(`/bookings/${x.id}/ticket`))) }); } catch (e) { toast(errMsg(e), 'error'); } };
  const b = useAsync(() => unwrapPaged(api.get('/bookings', { params: { limit: 50 } })), []);
  useSocket({ notification: (n) => { toast(`${n.title}: ${n.message}`, n.type === 'warning' ? 'error' : 'success'); b.reload(); } });
  if (b.loading) return <Spinner />; if (b.error) return <ErrorBox message={b.error} onRetry={b.reload} />;
  const items = b.data.items; const upcoming = items.filter((x) => ['reserved', 'active'].includes(x.status));
  return (
    <div className="stack"><h1>Hello, {user.name.split(' ')[0]}</h1>
      <div className="row"><Link className="btn primary" to="/locations"><Search size={16} /> Find parking</Link><Link className="btn" to="/account/vehicles"><Plus size={16} /> Add vehicle</Link></div>
      <div className="grid g3"><Stat label="Upcoming / active" value={upcoming.length} /><Stat label="Total bookings" value={b.data.meta.total} /><Stat label="Completed" value={items.filter((x) => x.status === 'completed').length} /></div>
      <section className="glass card"><h2>Next bookings</h2>{!upcoming.length ? <Empty title="No upcoming bookings"><p><Link className="btn primary" to="/locations">Find parking</Link></p></Empty> :
        upcoming.slice(0, 4).map((x) => <div key={x.id} className="row between" style={{ padding: '.4rem 0' }}><span>{x.locationName} - slot {x.slotLabel}<br /><span className="small muted">{dt(x.start)} to {dt(x.end)}</span></span><span className="row"><Badge value={x.status} /><button className="btn sm" onClick={() => showTicket(x)}><QrCode size={14} /> QR ticket</button></span></div>)}</section>
      {ticket && <TicketModal ticket={ticket} onClose={() => setTicket(null)} toast={toast} />}</div>
  );
}
export const BookRedirect = () => <Navigate to="/locations" replace />;

export function Bookings() {
  useTitle('Bookings & history'); const toast = useToast(); const [page, setPage] = useState(1);
  const b = useAsync(() => unwrapPaged(api.get('/bookings', { params: { page, limit: 10 } })), [page]);
  const [ticket, setTicket] = useState(null); const [cancel, setCancel] = useState(null); const [busy, setBusy] = useState(false); const [tab, setTab] = useState('all');
  const showTicket = async (x) => { try { setTicket({ ...x, ...(await unwrap(api.get(`/bookings/${x.id}/ticket`))) }); } catch (e) { toast(errMsg(e), 'error'); } };
  const doCancel = async () => { setBusy(true); try { await api.post(`/bookings/${cancel.id}/cancel`); toast('Booking cancelled'); setCancel(null); b.reload(); } catch (e) { toast(errMsg(e), 'error'); setCancel(null); } finally { setBusy(false); } };
  if (b.loading) return <Spinner />; if (b.error) return <ErrorBox message={b.error} onRetry={b.reload} />;
  const live = (x) => ['reserved', 'active'].includes(x.status); const shown = b.data.items.filter((x) => (tab === 'all' ? true : tab === 'upcoming' ? live(x) : !live(x)));
  return (
    <div className="stack"><h1>Bookings & parking history</h1>
      <div className="row" role="group" aria-label="Filter bookings">{[['all', 'All'], ['upcoming', 'Upcoming'], ['past', 'Past']].map(([k, l]) => <button key={k} className={`btn sm ${tab === k ? 'primary' : ''}`} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {!b.data.items.length ? <Empty title="No bookings yet"><p><Link className="btn primary" to="/locations">Find parking</Link></p></Empty> : (
        <div className="glass card table-wrap"><table><thead><tr><th>Location</th><th>Slot</th><th>Start</th><th>End</th><th>Entry</th><th>Exit</th><th>Duration</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>
          {shown.map((x) => <tr key={x.id}><td>{x.locationName}</td><td>{x.slotLabel}</td><td>{dt(x.start)}</td><td>{dt(x.end)}</td><td>{dt(x.entryAt)}</td><td>{dt(x.exitAt)}</td><td>{x.durationMinutes ? `${x.durationMinutes} min` : '-'}</td><td>{money(x.finalAmount ?? x.quote?.total, x.quote?.currency)}</td><td><Badge value={x.status} /></td>
            <td className="row">{['reserved', 'active'].includes(x.status) && <button className="btn sm" onClick={() => showTicket(x)}>QR ticket</button>}{x.status === 'reserved' && <button className="btn sm danger" onClick={() => setCancel(x)}>Cancel</button>}</td></tr>)}</tbody></table>{!shown.length && <Empty title="Nothing in this view" hint="Try another tab." />}</div>)}
      <div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn sm" disabled={page * 10 >= b.data.meta.total} onClick={() => setPage(page + 1)}>Next</button></div>
      {ticket && <TicketModal ticket={ticket} onClose={() => setTicket(null)} toast={toast} />}
      {cancel && <Confirm title="Cancel booking?" message={`Cancel your booking for slot ${cancel.slotLabel} on ${dt(cancel.start)}? This cannot be undone.`} confirmLabel="Cancel booking" busy={busy} onConfirm={doCancel} onClose={() => setCancel(null)} />}
    </div>
  );
}

export function Vehicles() {
  useTitle('My vehicles'); const toast = useToast(); const v = useAsync(() => unwrap(api.get('/vehicles')), []);
  const blank = { plate: '', type: 'car', make: '', model: '', color: '' }; const [f, setF] = useState(blank); const [err, setErr] = useState(''); const [del, setDel] = useState(null); const [busy, setBusy] = useState(false);
  const add = async (e) => { e.preventDefault(); setErr(''); setBusy(true); try { await api.post('/vehicles', { ...f, plate: f.plate.trim().toUpperCase(), make: f.make || undefined, model: f.model || undefined, color: f.color || undefined }); setF(blank); toast('Vehicle added'); v.reload(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } };
  const remove = async () => { try { await api.delete(`/vehicles/${del.id}`); toast('Vehicle removed'); v.reload(); } catch (x) { toast(errMsg(x), 'error'); } setDel(null); };
  return (
    <div className="stack"><h1>My vehicles</h1>
      <form className="glass card grid g3" onSubmit={add}>
        <Field label="Registration number" id="plate" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} required maxLength={16} />
        <Field label="Type" id="vt"><select id="vt" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['car', 'bike', 'suv', 'truck', 'ev'].map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Make (optional)" id="mk" value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} maxLength={40} />
        <Field label="Model (optional)" id="md" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} maxLength={40} />
        <Field label="Colour (optional)" id="cl" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} maxLength={30} />
        <div className="row" style={{ alignItems: 'end' }}><button className="btn primary" disabled={busy}>{busy ? 'Adding...' : 'Add vehicle'}</button></div>
        {err && <p className="err" role="alert" style={{ gridColumn: '1/-1' }}>{err}</p>}
      </form>
      {v.loading ? <Spinner /> : v.error ? <ErrorBox message={v.error} onRetry={v.reload} /> : !v.data.length ? <Empty title="No vehicles yet" hint="Add one above to start booking." /> :
        <div className="grid g3">{v.data.map((x) => { const Icon = VEHICLE_ICON[x.type] || Car; return (
          <div key={x.id} className="glass card stack lift"><div className="row between"><span className="vicon"><Icon size={20} /></span><span className="badge b-info">{x.type}</span></div>
            <h3 className="plate">{x.plate}</h3><p className="muted small" style={{ margin: 0 }}>{[x.make, x.model].filter(Boolean).join(' ') || 'No make/model'}{x.color ? ` - ${x.color}` : ''}</p>
            <button className="btn sm danger" onClick={() => setDel(x)}>Remove</button></div>); })}</div>}
      {del && <Confirm title="Remove vehicle?" message={`Remove ${del.plate}? Existing bookings keep their record.`} confirmLabel="Remove" onConfirm={remove} onClose={() => setDel(null)} />}
    </div>
  );
}

export function Payments() {
  useTitle('Transactions'); const p = useAsync(() => unwrapPaged(api.get('/payments/me', { params: { limit: 50 } })), []);
  if (p.loading) return <Spinner />; if (p.error) return <ErrorBox message={p.error} onRetry={p.reload} />;
  return <div className="stack"><h1>Transactions</h1>{!p.data.items.length ? <Empty title="No transactions yet" hint="Charges appear here after you exit a parking session." /> :
    <div className="glass card table-wrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>Method</th><th>Paid</th></tr></thead><tbody>{p.data.items.map((x) => <tr key={x._id}><td>{dt(x.createdAt)}</td><td>{money(x.amount, x.currency)}</td><td><Badge value={x.status} /></td><td>{x.method || '-'}</td><td>{dt(x.paidAt)}</td></tr>)}</tbody></table></div>}</div>;
}

export function Notifications() {
  useTitle('Notifications'); const n = useAsync(() => unwrapPaged(api.get('/notifications', { params: { limit: 50 } })), []);
  useSocket({ notification: () => n.reload() });
  const readAll = async () => { await api.patch('/notifications/read-all'); n.reload(); };
  if (n.loading) return <Spinner />; if (n.error) return <ErrorBox message={n.error} onRetry={n.reload} />;
  return <div className="stack"><div className="row between"><h1>Notifications</h1>{n.data.meta.unread > 0 && <button className="btn sm" onClick={readAll}>Mark all read</button>}</div>
    {!n.data.items.length ? <Empty title="You're all caught up" /> : n.data.items.map((x) => <div key={x._id} className="glass card" style={{ opacity: x.read ? 0.65 : 1 }}><strong>{x.title}</strong> <span className="small muted">{dt(x.createdAt)}</span><p style={{ margin: 0 }}>{x.message}</p></div>)}</div>;
}

export function Profile() {
  useTitle('Profile'); const toast = useToast(); const p = useAsync(() => unwrap(api.get('/users/me')), []);
  const [f, setF] = useState(null); const [pw, setPw] = useState({ currentPassword: '', newPassword: '' }); const [err, setErr] = useState('');
  const form = f || p.data; const { logout } = useAuth();
  if (p.loading) return <Spinner />; if (p.error) return <ErrorBox message={p.error} onRetry={p.reload} />;
  const save = async (e) => { e.preventDefault(); setErr(''); try { await api.put('/users/me', { name: form.name, phone: form.phone || '' }); toast('Profile saved'); } catch (x) { setErr(errMsg(x)); } };
  const change = async (e) => { e.preventDefault(); setErr(''); try { await api.post('/auth/change-password', pw); toast('Password changed. Please sign in again.'); await logout(); } catch (x) { setErr(errMsg(x)); } };
  return (
    <div className="stack"><h1>Profile</h1>
      <form className="glass card stack" onSubmit={save}><Field label="Name" id="pn" value={form.name || ''} onChange={(e) => setF({ ...form, name: e.target.value })} maxLength={80} /><Field label="Email" id="pe" value={form.email || ''} disabled readOnly /><Field label="Phone" id="pp" type="tel" value={form.phone || ''} onChange={(e) => setF({ ...form, phone: e.target.value })} maxLength={20} /><button className="btn primary">Save profile</button></form>
      <form className="glass card stack" onSubmit={change}><h2>Change password</h2><Field label="Current password" id="cp" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /><Field label="New password" id="np" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /><button className="btn">Change password</button></form>
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}

const VEHICLE_ICON = { car: Car, suv: Car, bike: Bike, truck: Truck, ev: Zap };

function TicketModal({ ticket, onClose, toast }) {
  return (
    <Modal title="Parking ticket" onClose={onClose}>
      <div className="ticket">
        <div className="row between"><strong>{ticket.locationName || 'Parking'}</strong><span className="badge b-available">Slot {ticket.slotLabel}</span></div>
        <p className="small muted" style={{ margin: '.3rem 0 0' }}>{dt(ticket.start)} to {dt(ticket.end)}</p>
        <div className="perf" />
        <div className="center" style={{ padding: '.25rem 0 0' }}><div className="qr"><QRCodeSVG value={ticket.token} size={200} /></div></div>
      </div>
      <div className="field" style={{ marginTop: '1rem' }}><label htmlFor="tk">Ticket code (for manual entry at the gate)</label><input id="tk" readOnly value={ticket.token} onFocus={(e) => e.target.select()} /></div>
      <div className="row" style={{ margin: '.5rem 0' }}><button className="btn sm" onClick={() => navigator.clipboard.writeText(ticket.token).then(() => toast('Ticket code copied'), () => toast('Copy failed. Select the code and copy it manually.', 'error'))}>Copy code</button></div>
      <p className="small muted">Show this code at entry and exit. It is single-use per action and expires {dt(ticket.expiresAt)}.</p>
      <button className="btn" onClick={onClose}>Close</button>
    </Modal>
  );
}
