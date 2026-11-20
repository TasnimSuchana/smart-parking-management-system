import { useLocation } from "react-router-dom";

/* Wrap your <Routes> (or page content) with this. Re-triggers on every route change. */
export default function PageTransition({ children }) {
  const { pathname } = useLocation();
  return <div key={pathname} className="ui-page">{children}</div>;
}
