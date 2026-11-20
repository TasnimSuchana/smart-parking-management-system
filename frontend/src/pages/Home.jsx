import { Link } from 'react-router-dom';
import { Zap, QrCode, ShieldCheck, Search, CalendarCheck, ScanLine, ArrowRight } from 'lucide-react';
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
    <section className="grid g3" aria-label="Live availability" style={{ marginBottom: '1.5rem' }}>
      <Stat label="Locations" value={data ? data.meta.total : '-'} /><Stat label="Slots available now" value={data ? t.available : '-'} /><Stat label="Total slots" value={data ? t.total : '-'} />
    </section>
  );
}

const FEATURES = [
  [Zap, 'Real-time availability', 'Slot status updates the moment a vehicle enters or leaves.'],
  [QrCode, 'QR tickets', 'Signed, expiring tickets scanned once at entry and exit.'],
  [ShieldCheck, 'Transparent pricing', 'See the exact breakdown, including peak and demand pricing, before you book.'],
];
const STEPS = [
  [Search, 'Find a location', 'Browse parking on the map and check free slots.'],
  [CalendarCheck, 'Reserve your slot', 'Pick a time, see the price, confirm in seconds.'],
  [ScanLine, 'Scan and park', 'Show your QR ticket at entry and exit. Pay on site.'],
];

export default function Home() {
  useTitle(''); const { user } = useAuth();
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Smart parking, simplified</span>
          <h1>Find a spot. Book it. <span className="grad">Park without the guesswork.</span></h1>
          <p>Live availability, transparent pricing and secure QR tickets. Sign in to see parking locations and book a slot.</p>
          <div className="row">{user ? <><Link className="btn primary" to="/locations">Find parking <ArrowRight size={16} /></Link><Link className="btn" to={homeFor(user.role)}>My dashboard</Link></> : <><Link className="btn primary" to="/login">Sign in <ArrowRight size={16} /></Link><Link className="btn" to="/register">Create account</Link></>}</div>
        </div>
      </section>
      {user && <LiveStats />}
      <section className="grid g3">
        {FEATURES.map(([I, h, p]) => (
          <div key={h} className="glass card lift"><span className="vicon"><I size={20} /></span><h3 style={{ marginTop: '.75rem' }}>{h}</h3><p className="muted" style={{ marginBottom: 0 }}>{p}</p></div>))}
      </section>
      <section style={{ marginTop: '2.5rem' }} aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <div className="grid g3" style={{ marginTop: '1rem' }}>
          {STEPS.map(([I, h, p], i) => (
            <div key={h} className="glass card step"><span className="stepn">{i + 1}</span><I size={20} color="#22d3ee" /><h3 style={{ margin: '.5rem 0 .25rem' }}>{h}</h3><p className="muted" style={{ marginBottom: 0 }}>{p}</p></div>))}
        </div>
      </section>
      {!user && (
        <section className="glass cta">
          <div><h2 style={{ marginBottom: '.25rem' }}>Ready to park smarter?</h2><p className="muted" style={{ margin: 0 }}>Create a free account and book your first slot in minutes.</p></div>
          <Link className="btn primary" to="/register">Create account <ArrowRight size={16} /></Link>
        </section>)}
    </>
  );
}
