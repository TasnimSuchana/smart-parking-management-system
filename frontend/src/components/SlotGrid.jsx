export default function SlotGrid({ slots, selected, onSelect, onlyAvailable = false }) {
  if (!slots.length) return null;
  return (
    <>
      <div className="slots" role="list">
        {slots.map((s) => (
          <button key={s.id} role="listitem" type="button" className={`slot ${s.status} ${selected === s.id ? 'sel' : ''}`} disabled={!onSelect || s.status === 'maintenance' || (onlyAvailable && s.status !== 'available')}
            onClick={() => onSelect?.(s)} aria-label={`Slot ${s.label}, ${s.category}, ${s.status}`}>
            {s.label}<small>{s.category}</small>
          </button>
        ))}
      </div>
      <div className="legend" style={{ marginTop: '.75rem' }}>{['available', 'reserved', 'occupied', 'maintenance'].map((k) => <span key={k}><span className={`badge b-${k}`}>{k}</span> {slots.filter((s) => s.status === k).length}</span>)}{onSelect && <span><span className="badge" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>selected</span> {selected ? 1 : 0}</span>}</div>
    </>
  );
}
