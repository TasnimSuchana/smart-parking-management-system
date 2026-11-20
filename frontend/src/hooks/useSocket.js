import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// One shared socket per tab; reconnection is automatic with back-off.
let socket;
const get = () => (socket ||= io('/', { path: '/socket.io', withCredentials: true, reconnectionDelayMax: 8000 }));

export function useSocket(handlers = {}, { locationId } = {}) {
  const [connected, setConnected] = useState(false);
  const ref = useRef(handlers); ref.current = handlers;
  useEffect(() => {
    const s = get(); const subs = [];
    const sub = () => { if (locationId) s.emit('subscribe:location', locationId, (r) => ref.current.__subscribed?.(r)); };
    const on = () => { setConnected(true); sub(); }, off = () => setConnected(false);
    s.on('connect', on); s.on('disconnect', off); setConnected(s.connected); if (s.connected) sub();
    for (const ev of Object.keys(ref.current)) { if (ev.startsWith('__')) continue; const fn = (...a) => ref.current[ev]?.(...a); s.on(ev, fn); subs.push([ev, fn]); }
    return () => { s.off('connect', on); s.off('disconnect', off); subs.forEach(([e, f]) => s.off(e, f)); };
  }, [locationId]);
  return { connected };
}
