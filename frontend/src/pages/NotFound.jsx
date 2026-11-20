import { Link } from 'react-router-dom';
import { useTitle } from '../hooks/useTitle.js';
export default function NotFound() {
  useTitle('Page not found');
  return <div className="center"><div><h1>404 - Page not found</h1><p className="muted">The page you are looking for does not exist or has moved.</p><Link className="btn primary" to="/">Back to homepage</Link></div></div>;
}
