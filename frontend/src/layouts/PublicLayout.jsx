import { Outlet } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import PageTransition from '../ui/PageTransition.jsx';
export default function PublicLayout() {
  return <><a className="skip" href="#main">Skip to content</a><Navbar /><main id="main" className="container"><PageTransition><Outlet /></PageTransition></main><Footer /></>;
}
