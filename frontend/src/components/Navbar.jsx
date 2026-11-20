import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, LogOut, ParkingSquare } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

export const homeFor = (role) => (role === 'admin' ? '/admin' : '/account');

export default function Navbar() {
  const { user, logout } = useAuth(); const [open, setOpen] = useState(false); const loc = useLocation(); const nav = useNavigate();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <header className="glass nav">
      <div className="container inner">
        <Link to="/" className="brand" aria-label="Smart Parking home"><span className="logo"><ParkingSquare size={18} /></span>Smart Parking</Link>
        <button className="btn sm menu-btn" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen(!open)}>{open ? <X size={18} /> : <Menu size={18} />}</button>
        <nav id="main-nav" className={`links ${open ? 'open' : ''}`} aria-label="Main">
          <NavLink to="/" end>Home</NavLink>
          {user && <NavLink to="/locations">Find parking</NavLink>}
          {user && <NavLink to={homeFor(user.role)}>Dashboard</NavLink>}
          <span className="right row">
            {user ? <button className="btn sm" onClick={async () => { await logout(); nav('/'); }}><LogOut size={15} /> Sign out</button>
              : <><Link className="btn sm" to="/login">Sign in</Link><Link className="btn sm primary" to="/register">Register</Link></>}
          </span>
        </nav>
      </div>
    </header>
  );
}
