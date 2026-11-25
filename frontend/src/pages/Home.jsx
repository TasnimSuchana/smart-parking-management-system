import { Link } from 'react-router-dom';
import { Search, CalendarCheck, LayoutDashboard, ArrowUpRight } from 'lucide-react';
import { useTitle } from '../hooks/useTitle.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import api, { unwrapPaged } from '../services/api.js';
import { Stat } from '../components/UI.jsx';
import { homeFor } from '../components/Navbar.jsx';

// Live numbers are only loaded for signed-in users; guests see no parking data.
function LiveStats() {
  const { data } = useAsync(() => unwrapPaged(api.get('/parking/locations', { params: { limit: 100 } })), []);
  const t = (data?.items || []).reduce((a, l) => ({ total: a.total + l.slots.total, available: a.available + l.slots.available }), { total: 0, available: 0 });
  return (
    <section className="grid g3" aria-label="Live availability" style={{ marginTop: '1.5rem' }}>
      <Stat label="Locations" value={data ? data.meta.total : '-'} /><Stat label="Slots available now" value={data ? t.available : '-'} /><Stat label="Total slots" value={data ? t.total : '-'} />
    </section>
  );
}

// Decorative illustration only: no real locations or availability are shown to guests.
function MapArt({ user }) {
  return (
    <div className="hero-map" aria-hidden="true">
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
        <rect width="400" height="300" fill="#dfe9e3" />
        <path d="M-10 230 C80 200 140 250 230 220 S360 180 420 200 L420 320 L-10 320Z" fill="#cfe0e6" />
        <rect x="30" y="30" width="90" height="60" rx="14" fill="#cfe3d6" />
        <g stroke="#fff" strokeWidth="14" strokeLinecap="round" fill="none"><path d="M-10 90 L410 130" /><path d="M120 -10 L170 310" /><path d="M280 -10 L240 310" /></g>
        <g stroke="#fff" strokeWidth="6" strokeLinecap="round" fill="none" opacity=".9"><path d="M-10 170 L410 200" /><path d="M60 -10 L90 310" /><path d="M340 -10 L370 310" /></g>
        <circle cx="200" cy="130" r="70" fill="none" stroke="#fff" strokeWidth="2" opacity=".8" />
        <path d="M200 88c-17 0-30 13-30 30 0 23 30 54 30 54s30-31 30-54c0-17-13-30-30-30z" fill="#1f6b4f" />
        <circle cx="200" cy="118" r="10" fill="#fff" />
      </svg>
      <div className="hero-map-card"><span className="logo">P</span><div><b>Parking near you</b><small>{user ? 'Open Find parking to see live availability' : 'Sign in to see live availability'}</small></div></div>
    </div>
  );
}

const CARDS = (user) => [
  [Search, 'Find your fit', 'Browse locations and filter options by availability, area and hourly price.', 'Explore locations', '/locations', false],
  [CalendarCheck, 'Plan ahead', 'Choose your arrival window and see live slot availability before you book.', user ? 'Book a slot' : 'Get started', user ? '/locations' : '/register', true],
  [LayoutDashboard, 'Stay in control', 'Keep track of your bookings, vehicles and QR tickets from a single dashboard.', user ? 'Dashboard' : 'Sign in', user ? homeFor(user.role) : '/login', false],
];

export default function Home() {
  useTitle(''); const { user } = useAuth();
  return (
    <>
      <section className="band hero-band">
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="eyebrow dot-eyebrow">Smarter city parking</span>
            <h1>Your space in the city, <span className="grad">already found.</span></h1>
            <p>Skip the search. Explore convenient parking locations, compare availability and plan your arrival in one simple place.</p>
            <div className="row">
              <Link className="btn primary" to="/locations">Explore locations <ArrowUpRight size={16} /></Link>
              {user ? <Link className="btn" to={homeFor(user.role)}>My dashboard</Link> : <Link className="btn" to="/register">Create a free account</Link>}
            </div>
            <p className="small muted" style={{ marginTop: '1rem' }}>Designed for easier everyday arrivals</p>
          </div>
          <MapArt user={user} />
        </div>
      </section>
      <div className="strip"><span><i>01</i> Search local parking</span><span><i>02</i> Compare your options</span><span><i>03</i> Plan your arrival</span><span className="muted right">{user ? 'Availability updates in real time.' : 'Availability is shown after you sign in.'}</span></div>
      {user && <LiveStats />}
      <div className="sechead"><div><span className="eyebrow">A better way to arrive</span><h2 className="big">Parking that fits your day.</h2></div><p className="muted" style={{ maxWidth: 360, margin: 0 }}>Clear information to help you choose the right spot, without the last-minute guesswork.</p></div>
      <section className="grid g3">
        {CARDS(user).map(([I, h, p, l, to, dark], i) => (
          <div key={h} className={`glass card fcard lift ${dark ? 'dark' : ''}`}><span className="no">0{i + 1}</span><span className="vicon"><I size={18} /></span><h3>{h}</h3><p>{p}</p><Link className="flink" to={to}>{l} <ArrowUpRight size={14} /></Link></div>))}
      </section>
      {!user && (
        <section className="cta2">
          <div><span className="eyebrow">Ready when you are</span><h2 className="big" style={{ margin: '.25rem 0' }}>Make room for what matters.</h2><p style={{ margin: 0, opacity: .85 }}>Create an account to explore parking with live availability.</p></div>
          <Link className="btn light" to="/register">Create your account <ArrowUpRight size={16} /></Link>
        </section>)}
    </>
  );
}
