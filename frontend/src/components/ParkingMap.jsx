import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/map.css';
import { availabilityLevel, hasCoords, LEVEL_LABEL } from '../utils/geo.js';

const COLORS = { plenty: 'var(--ok, #1f7a4f)', limited: 'var(--warn, #b7791f)', full: 'var(--bad, #c0392b)', unavailable: 'var(--muted, #6b7280)' };

// OpenStreetMap standard tiles. They need an internet connection and https://tile.openstreetmap.org in the
// nginx Content-Security-Policy img-src (infrastructure/nginx/nginx.conf).
// INTEGRATION POINT: to use another tile provider (MapTiler, Mapbox, Google), change TILE_URL / TILE_ATTRIBUTION
// and allow that host in img-src. The props (locations, selectedId, onSelect, userPos) stay the same.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

const shortName = (name = '') => (name.length > 18 ? `${name.slice(0, 17)}...` : name);
const validPos = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

function pinElement(l, level, selected) {
  const el = document.createElement('div');
  el.className = `pmap-pin pmap-pin--${level}${selected ? ' is-selected' : ''}`;
  el.textContent = String(l.slots?.available ?? 0);
  return el;
}

export default function ParkingMap({ locations, selectedId, onSelect, userPos }) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const userMarkerRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const [tilesFailed, setTilesFailed] = useState(false);

  onSelectRef.current = onSelect;
  const pts = (locations || []).filter(hasCoords);
  const hasPts = pts.length > 0;

  // Keys so effects re-run only when something the map shows has actually changed.
  const markerKey = pts.map((l) => `${l._id}|${l.lat}|${l.lng}|${l.name}|${l.slots?.available ?? 0}|${availabilityLevel(l)}`).join(';');
  const fitKey = `${pts.map((l) => `${l._id}:${l.lat}:${l.lng}`).join(';')}|${validPos(userPos) ? `${userPos.lat}:${userPos.lng}` : ''}`;

  // 1) Create the map once (and tear it down when there are no positions left).
  useEffect(() => {
    if (!hasPts || !hostRef.current) return undefined;
    const host = hostRef.current;
    const map = L.map(host, { scrollWheelZoom: false });
    const tiles = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION });
    let failed = false;
    tiles.on('tileerror', () => { if (!failed) { failed = true; setTilesFailed(true); } });
    tiles.on('tileload', () => { if (failed) { failed = false; setTilesFailed(false); } });
    tiles.addTo(map);
    // Mouse wheel zooms the map only after the map has been clicked, so page scrolling is not hijacked.
    map.on('click', () => map.scrollWheelZoom.enable());
    map.on('mouseout', () => map.scrollWheelZoom.disable());
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize()) : null;
    if (ro) ro.observe(host);
    return () => {
      if (ro) ro.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      userMarkerRef.current = null;
    };
  }, [hasPts]);

  // 2) Draw the parking markers (colour = availability, number = free slots).
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    pts.forEach((l) => {
      const level = availabilityLevel(l);
      const selected = selectedId === l._id;
      const marker = L.marker([l.lat, l.lng], {
        icon: L.divIcon({ html: pinElement(l, level, selected), className: 'pmap-icon', iconSize: [36, 36], iconAnchor: [18, 18] }),
        title: `${l.name}: ${LEVEL_LABEL[level]}, ${l.slots?.available ?? 0} of ${l.slots?.total ?? 0} slots available`,
        alt: l.name,
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: selected ? 1000 : 0,
      });
      const label = document.createElement('span');
      label.textContent = shortName(l.name);
      marker.bindTooltip(label, { permanent: true, direction: 'bottom', offset: [0, 16], className: 'pmap-label', opacity: 1 });
      marker.on('click', () => { if (onSelectRef.current) onSelectRef.current(l._id); });
      marker.addTo(layer);
    });
  }, [markerKey, selectedId, hasPts]);

  // 3) The user's own position ("Use my location").
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (userMarkerRef.current) { userMarkerRef.current.remove(); userMarkerRef.current = null; }
    if (validPos(userPos)) {
      userMarkerRef.current = L.circleMarker([userPos.lat, userPos.lng], { radius: 8, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 })
        .bindTooltip('You', { direction: 'top' })
        .addTo(map);
    }
  }, [userPos?.lat, userPos?.lng, hasPts]);

  // 4) Zoom to fit all locations whenever the set of visible locations (or the user position) changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const points = pts.map((l) => [l.lat, l.lng]);
    if (validPos(userPos)) points.push([userPos.lat, userPos.lng]);
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 16 });
  }, [fitKey, hasPts]);

  // 5) Move to the selected location.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const l = pts.find((p) => p._id === selectedId);
    if (l) map.panTo([l.lat, l.lng]);
  }, [selectedId]);

  if (!hasPts) {
    return <div className="empty"><strong>No map positions yet</strong><p className="small">Locations appear on the map once an administrator adds their latitude and longitude. They are still listed below.</p></div>;
  }

  return (
    <div className="pmap-wrap">
      <div ref={hostRef} className="pmap" role="group" aria-label="Parking locations map" />
      {tilesFailed && <p className="small pmap-note">The map background could not load (check your internet connection). Parking locations are still shown.</p>}
      <div className="legend" style={{ marginTop: '.5rem' }}>
        {Object.entries(LEVEL_LABEL).map(([k, v]) => <span key={k}><span className="dot" style={{ background: COLORS[k] }} /> {v}</span>)}
        <span>Number = free slots</span>
      </div>
    </div>
  );
}
