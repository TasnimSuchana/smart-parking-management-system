import { Link } from 'react-router-dom';
import { ParkingSquare } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
const email = import.meta.env.VITE_SUPPORT_EMAIL, phone = import.meta.env.VITE_SUPPORT_PHONE;
export default function Footer() {
  const { user } = useAuth();
  return (
    <footer className="footer"><div className="container">
      <div className="cols">
        <div>
          <Link to="/" className="brand" aria-label="Smart Parking home"><span className="logo"><ParkingSquare size={18} /></span>Smart Parking</Link>
          <p className="small" style={{ marginTop: '.6rem', maxWidth: 320 }}>Find a space, reserve it, and get a QR ticket for entry.</p>
        </div>
        <nav className="col" aria-label="Footer">
          <h4>Explore</h4>
          <Link to="/">Home</Link>
          {user ? <Link to="/locations">Find parking</Link> : <><Link to="/login">Sign in</Link><Link to="/register">Register</Link></>}
        </nav>
        {(email || phone) && (
          <div className="col">
            <h4>Contact</h4>
            {email && <a href={`mailto:${email}`}>{email}</a>}
            {phone && <a href={`tel:${phone.replace(/[^+\d]/g, '')}`}>{phone}</a>}
          </div>)}
      </div>
      <div className="legal small">&copy; {new Date().getFullYear()} Smart Parking. All rights reserved.</div>
    </div></footer>
  );
}
