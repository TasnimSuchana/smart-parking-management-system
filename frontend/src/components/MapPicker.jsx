import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Modal } from './UI.jsx';

const DHAKA = [23.8103, 90.4125];
const valid = (v) => v !== '' && v != null && Number.isFinite(Number(v));

export default function MapPicker({ lat, lng, onConfirm, onClose }) {
  const el = useRef(null); const map = useRef(null); const mk = useRef(null);
  const start = valid(lat) && valid(lng) ? [Number(lat), Number(lng)] : null;
  const [pos, setPos] = useState(start); const [msg, setMsg] = useState('');

  const place = (ll, pan) => {
    const p = [ll.lat ?? ll[0], ll.lng ?? ll[1]];
    if (!mk.current) {
      mk.current = L.marker(p, { draggable: true, icon: L.divIcon({ className: 'pk-marker', html: '<span class="pk-pin">P</span>', iconSize: [44, 32], iconAnchor: [22, 32] }) }).addTo(map.current);
      mk.current.on('dragend', () => { const q = mk.current.getLatLng(); setPos([q.lat, q.lng]); });
    } else mk.current.setLatLng(p);
    if (pan) map.current.setView(p, Math.max(map.current.getZoom(), 16));
    setPos(p);
  };

  useEffect(() => {
    const m = L.map(el.current).setView(start || DHAKA, start ? 16 : 12); map.current = m;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
    if (start) place(start, false);
    m.on('click', (e) => place(e.latlng, false));
    const t = setTimeout(() => m.invalidateSize(), 100);
    return () => { clearTimeout(t); m.remove(); map.current = null; mk.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locate = () => {
    setMsg('');
    if (!navigator.geolocation) return setMsg('This browser cannot find your location.');
    navigator.geolocation.getCurrentPosition((r) => place({ lat: r.coords.latitude, lng: r.coords.longitude }, true), () => setMsg('Could not get your location. Click the map instead.'), { timeout: 8000 });
  };

  return createPortal(
    <Modal title="Pick location on map" onClose={onClose}>
      <p className="small muted">Click the map to place the pin, or drag the pin to adjust. Zoom in for accuracy.</p>
      <div ref={el} className="mapbox picker" role="region" aria-label="Location picker map" />
      <p className="small" aria-live="polite" style={{ margin: '.6rem 0' }}>{pos ? <>Selected: <code>{pos[0].toFixed(6)}, {pos[1].toFixed(6)}</code></> : 'No location selected yet.'}{msg && <span className="err"> {msg}</span>}</p>
      <div className="row">
        <button type="button" className="btn primary" disabled={!pos} onClick={() => onConfirm(pos[0], pos[1])}>Use this location</button>
        <button type="button" className="btn" onClick={locate}>Use my location</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>,
    document.body
  );
}
