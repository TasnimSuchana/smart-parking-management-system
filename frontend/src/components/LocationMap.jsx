import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const hasPos = (l) => Number.isFinite(l.lat) && Number.isFinite(l.lng);

export default function LocationMap({ items, activeId, onSelect, onOpen, visible = true }) {
  const el = useRef(null); const map = useRef(null); const layer = useRef(null); const markers = useRef({});
  const cb = useRef({ onSelect, onOpen }); cb.current = { onSelect, onOpen };

  useEffect(() => {
    const m = L.map(el.current, { scrollWheelZoom: false }).setView([23.8103, 90.4125], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
    layer.current = L.layerGroup().addTo(m); map.current = m;
    return () => { m.remove(); map.current = null; markers.current = {}; };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    layer.current.clearLayers(); markers.current = {};
    const pts = [];
    items.filter(hasPos).forEach((l) => {
      const n = Number(l.slots?.available) || 0;
      const icon = L.divIcon({ className: 'pk-marker', html: `<span class="pk-pin${n ? '' : ' full'}">${n}</span>`, iconSize: [44, 32], iconAnchor: [22, 32], popupAnchor: [0, -30] });
      const mk = L.marker([l.lat, l.lng], { icon, title: l.name }).addTo(layer.current);
      const box = document.createElement('div'); box.className = 'pk-pop';
      const t = document.createElement('strong'); t.textContent = l.name; box.appendChild(t);
      const a = document.createElement('div'); a.textContent = `${n} of ${l.slots?.total ?? 0} free`; box.appendChild(a);
      const b = document.createElement('button'); b.type = 'button'; b.textContent = 'View slots & prices'; b.onclick = () => cb.current.onOpen?.(l._id); box.appendChild(b);
      mk.bindPopup(box); mk.on('click', () => cb.current.onSelect?.(l._id));
      markers.current[l._id] = mk; pts.push([l.lat, l.lng]);
    });
    if (pts.length) map.current.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
  }, [items]);

  useEffect(() => {
    Object.entries(markers.current).forEach(([id, mk]) => {
      mk.getElement()?.classList.toggle('active', id === activeId); mk.setZIndexOffset(id === activeId ? 1000 : 0);
    });
    const mk = markers.current[activeId]; if (mk && map.current) map.current.panTo(mk.getLatLng());
  }, [activeId, items]);

  useEffect(() => { if (visible && map.current) setTimeout(() => map.current?.invalidateSize(), 60); }, [visible]);

  return <div ref={el} className="mapbox" role="region" aria-label="Parking map" />;
}
