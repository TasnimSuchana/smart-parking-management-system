import { NavLink, Outlet } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import PageTransition from '../ui/PageTransition.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const MENUS = {
  user: [['/account', 'Overview', true], ['/account/book', 'Book parking'], ['/account/bookings', 'Bookings & history'], ['/account/vehicles', 'Vehicles'], ['/account/payments', 'Transactions'], ['/account/notifications', 'Notifications'], ['/account/profile', 'Profile']],
  admin: [['/admin', 'Overview', true], ['/admin/locations', 'Locations & slots'], ['/admin/users', 'Users'], ['/admin/pricing', 'Pricing'], ['/admin/scan', 'Scan QR tickets'], ['/admin/records', 'Daily records'], ['/admin/bookings', 'Transactions'], ['/admin/camera', 'Cameras'], ['/admin/security', 'Security logs']],
};
export default function DashboardLayout() {
  const { user } = useAuth();
  return (
    <><a className="skip" href="#main">Skip to content</a><Navbar />
      <div className="container shell">
        <nav className="glass side" aria-label="Dashboard">{MENUS[user.role].map(([to, label, end]) => <NavLink key={to} to={to} end={end}>{label}</NavLink>)}</nav>
        <main id="main" style={{ minWidth: 0 }}><PageTransition><Outlet /></PageTransition></main>
      </div><Footer /></>
  );
}
