export const hasCoords = (l) => Number.isFinite(l?.lat) && Number.isFinite(l?.lng);

// Great-circle distance in km (haversine).
export function distanceKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Opening hours use the viewer's local clock. Locations without hours (or open24h) are open all day.
export function openStatus(l, now = new Date()) {
  if (l.open24h !== false || !l.opensAt || !l.closesAt) return { open: true, label: 'Open 24/7' };
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const cur = now.getHours() * 60 + now.getMinutes(), o = toMin(l.opensAt), c = toMin(l.closesAt);
  const open = o <= c ? cur >= o && cur < c : cur >= o || cur < c;
  return { open, label: open ? `Open until ${l.closesAt}` : `Closed, opens ${l.opensAt}` };
}

// plenty (>=30% free) | limited | full | unavailable (no usable slots / location inactive)
export function availabilityLevel(l) {
  const { total = 0, available = 0, maintenance = 0 } = l.slots || {};
  if (l.active === false || !total || maintenance >= total) return 'unavailable';
  if (available === 0) return 'full';
  return available / (total - maintenance) >= 0.3 ? 'plenty' : 'limited';
}
export const LEVEL_LABEL = { plenty: 'Plenty of space', limited: 'Limited space', full: 'Full', unavailable: 'Unavailable' };

// Standard hourly rate for a car at this location (peak and demand pricing are applied at booking time).
export function hourlyPrice(l, pricing) {
  const r = pricing?.locations?.[l._id] || pricing?.default; if (!r) return null;
  return { amount: Math.round(r.baseHourly * (r.vehicleMultipliers?.car ?? 1) * 100) / 100, currency: r.currency };
}
