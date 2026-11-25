import { useState } from 'react';
import api from '../services/api.js';
import { Field } from './UI.jsx';
import { errMsg } from '../utils/format.js';

// Shows only the signed-in user's vehicles (the API filters by owner). Includes an inline "Add vehicle" form.
export default function VehicleSelector({ vehicles, value, onChange, onAdded }) {
  const [open, setOpen] = useState(false); const [f, setF] = useState({ plate: '', type: 'car' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const add = async (e) => { e.preventDefault(); setErr(''); setBusy(true);
    try { const r = await api.post('/vehicles', { plate: f.plate.trim().toUpperCase(), type: f.type }); setOpen(false); setF({ plate: '', type: 'car' }); await onAdded(r.data.data); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } };
  return (
    <div className="stack">
      {!vehicles.length && !open && <div className="empty"><strong>You don't have a vehicle yet.</strong><p className="small">Add a vehicle so we can price and verify your booking.</p></div>}
      <div className="grid g3" role="radiogroup" aria-label="Choose a vehicle">
        {vehicles.map((v) => (
          <label key={v.id} className={`glass card pick ${value === v.id ? 'sel-card' : ''}`}>
            <input type="radio" name="vehicle" checked={value === v.id} onChange={() => onChange(v.id)} style={{ width: 'auto', minHeight: 0 }} />
            <strong style={{ marginLeft: '.5rem' }}>{v.plate}</strong><div className="small muted">{v.type}{v.make ? ` · ${v.make} ${v.model || ''}` : ''}</div>
          </label>))}
      </div>
      {!open ? <button type="button" className="btn" onClick={() => setOpen(true)}>Add vehicle</button> : (
        <form className="glass card grid g3" onSubmit={add}>
          <Field label="Registration number" id="nv-plate" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} required maxLength={16} />
          <Field label="Type" id="nv-type"><select id="nv-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['car', 'bike', 'suv', 'truck', 'ev'].map((t) => <option key={t}>{t}</option>)}</select></Field>
          <div className="row" style={{ alignItems: 'end' }}><button className="btn primary" disabled={busy}>{busy ? 'Adding...' : 'Save vehicle'}</button><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button></div>
          {err && <p className="err" role="alert" style={{ gridColumn: '1/-1' }}>{err}</p>}
        </form>)}
    </div>
  );
}
