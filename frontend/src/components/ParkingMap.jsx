import { availabilityLevel, hasCoords, LEVEL_LABEL } from '../utils/geo.js';

const COLORS = { plenty: 'var(--ok)', limited: 'var(--warn)', full: 'var(--bad)', unavailable: 'var(--muted)' };

// Schematic map: places locations by latitude/longitude on a plain SVG canvas (no map provider, no paid dependency).
// INTEGRATION POINT: to use Google Maps or OpenStreetMap later, replace this component with one that accepts the
// same props (locations, selectedId, onSelect) and renders its own markers using availabilityLevel() colours.
export default function ParkingMap({ locations, selectedId, onSelect, userPos }) {
  const pts = locations.filter(hasCoords);
  if (!pts.length) return <div className="empty"><strong>No map positions yet</strong><p className="small">Locations appear on the map once an administrator adds their latitude and longitude. They are still listed below.</p></div>;
  const all = userPos ? [...pts, userPos] : pts;
  let minLat = Math.min(...all.map((p) => p.lat)), maxLat = Math.max(...all.map((p) => p.lat)), minLng = Math.min(...all.map((p) => p.lng)), maxLng = Math.max(...all.map((p) => p.lng));
  if (maxLat - minLat < 0.01) { minLat -= 0.005; maxLat += 0.005; } if (maxLng - minLng < 0.01) { minLng -= 0.005; maxLng += 0.005; }
  const W = 800, H = 380, P = 56;
  const x = (lng) => P + ((lng - minLng) / (maxLng - minLng)) * (W - 2 * P), y = (lat) => H - P - ((lat - minLat) / (maxLat - minLat)) * (H - 2 * P);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Parking locations map" style={{ width: '100%', borderRadius: 12, background: 'rgba(0,0,0,.25)', border: '1px solid var(--border)' }}>
        {[1, 2, 3, 4, 5].map((i) => <line key={`v${i}`} x1={(W / 6) * i} y1="0" x2={(W / 6) * i} y2={H} stroke="rgba(255,255,255,.05)" />)}
        {[1, 2, 3].map((i) => <line key={`h${i}`} x1="0" y1={(H / 4) * i} x2={W} y2={(H / 4) * i} stroke="rgba(255,255,255,.05)" />)}
        {userPos && <g><circle cx={x(userPos.lng)} cy={y(userPos.lat)} r="7" fill="var(--accent)" /><text x={x(userPos.lng)} y={y(userPos.lat) - 12} textAnchor="middle" fontSize="12" fill="var(--text)">You</text></g>}
        {pts.map((l) => {
          const lvl = availabilityLevel(l), cx = x(l.lng), cy = y(l.lat), sel = selectedId === l._id;
          return (
            <g key={l._id} role="button" tabIndex={0} aria-label={`${l.name}: ${LEVEL_LABEL[lvl]}, ${l.slots?.available ?? 0} of ${l.slots?.total ?? 0} slots available`} aria-pressed={sel}
              onClick={() => onSelect(l._id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(l._id))} style={{ cursor: 'pointer' }}>
              {sel && <circle cx={cx} cy={cy} r="24" fill="none" stroke="var(--accent)" strokeWidth="2" />}
              <circle cx={cx} cy={cy} r="17" style={{ fill: COLORS[lvl] }} stroke="rgba(0,0,0,.4)" strokeWidth="2" />
              <text x={cx} y={cy + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#04111a">{l.slots?.available ?? 0}</text>
              <text x={cx} y={cy + 36} textAnchor="middle" fontSize="12" fill="var(--text)">{l.name.length > 18 ? `${l.name.slice(0, 17)}...` : l.name}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend" style={{ marginTop: '.5rem' }}>{Object.entries(LEVEL_LABEL).map(([k, v]) => <span key={k}><span className="dot" style={{ background: COLORS[k] }} /> {v}</span>)}<span>Number = free slots</span></div>
    </div>
  );
}
