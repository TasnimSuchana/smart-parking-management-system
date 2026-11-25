import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Brand, homeFor } from './Navbar.jsx';
const email = import.meta.env.VITE_SUPPORT_EMAIL, phone = import.meta.env.VITE_SUPPORT_PHONE;
export default function Footer() {
  const { user } = useAuth();
  return (
    <footer className="footer deep"><div className="container">
      <div className="foot-top">
        <div className="foot-brand"><Brand /><p>Less circling. More arriving.</p></div>
        <nav className="foot-links" aria-label="Footer">
          <Link to="/locations">Explore parking</Link>
          {user ? <Link to={homeFor(user.role)}>Dashboard</Link> : <><Link to="/login">Sign in</Link><Link to="/register">Create account</Link></>}
          {email && <a href={`mailto:${email}`}>{email}</a>}
          {phone && <a href={`tel:${phone.replace(/[^+\d]/g, '')}`}>{phone}</a>}
        </nav>
      </div>
      <div className="legal small">&copy; {new Date().getFullYear()} Smart Parking</div>
    </div></footer>
  );
}
