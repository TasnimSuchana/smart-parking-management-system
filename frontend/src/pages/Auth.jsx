import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useTitle } from '../hooks/useTitle.js';
import api, { unwrap } from '../services/api.js';
import { Field } from '../components/UI.jsx';
import { homeFor } from '../components/Navbar.jsx';
import { errMsg, passwordProblem, validEmail } from '../utils/format.js';

function Shell({ title, children }) { return <div className="glass card auth stack"><h1>{title}</h1>{children}</div>; }

export function Login() {
  useTitle('Sign in'); const { user, login } = useAuth(); const nav = useNavigate(); const loc = useLocation();
  const [f, setF] = useState({ email: '', password: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  const submit = async (e) => { e.preventDefault(); if (!validEmail(f.email)) return setErr('Enter a valid email address'); setErr(''); setBusy(true);
    try { const u = await login(f.email, f.password); nav(loc.state?.from || homeFor(u.role), { replace: true }); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } };
  return (
    <Shell title="Sign in"><form className="stack" onSubmit={submit} noValidate>
      <Field label="Email" id="email" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
      <Field label="Password" id="pw" type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn primary" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
      <p className="small muted"><Link to="/forgot-password">Forgot password?</Link> &middot; <Link to="/register">Create account</Link></p></form></Shell>
  );
}

export function Register() {
  useTitle('Create account'); const { user, register } = useAuth(); const nav = useNavigate(); const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', password: '' }); const [errs, setErrs] = useState({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  const submit = async (e) => { e.preventDefault(); const v = {};
    if (f.name.trim().length < 2) v.name = 'Enter your name'; if (!validEmail(f.email)) v.email = 'Enter a valid email'; const p = passwordProblem(f.password); if (p) v.password = p;
    setErrs(v); if (Object.keys(v).length) return; setErr(''); setBusy(true);
    try { await register({ ...f, name: f.name.trim() }); toast('Welcome! Your account is ready.'); nav('/account'); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } };
  return (
    <Shell title="Create account"><form className="stack" onSubmit={submit} noValidate>
      <Field label="Full name" id="name" autoComplete="name" value={f.name} error={errs.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} />
      <Field label="Email" id="email" type="email" autoComplete="email" value={f.email} error={errs.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <Field label="Password" id="pw" type="password" autoComplete="new-password" value={f.password} error={errs.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      <p className="small muted">At least 10 characters with upper-case, lower-case and a number.</p>
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn primary" disabled={busy}>{busy ? 'Creating...' : 'Create account'}</button>
      <p className="small muted">Already registered? <Link to="/login">Sign in</Link></p></form></Shell>
  );
}

export function ForgotPassword() {
  useTitle('Forgot password'); const [email, setEmail] = useState(''); const [done, setDone] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => { e.preventDefault(); if (!validEmail(email)) return setErr('Enter a valid email'); setErr(''); setBusy(true); try { await api.post('/auth/forgot-password', { email }); setDone(true); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } };
  return <Shell title="Reset your password">{done ? <p>If that email is registered, a reset link is on its way. It expires in 30 minutes.</p> : <form className="stack" onSubmit={submit} noValidate>
    <Field label="Email" id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />{err && <p className="err" role="alert">{err}</p>}<button className="btn primary" disabled={busy}>{busy ? 'Sending...' : 'Send reset link'}</button></form>}<Link to="/login">Back to sign in</Link></Shell>;
}

export function ResetPassword() {
  useTitle('Choose a new password'); const [sp] = useSearchParams(); const nav = useNavigate(); const toast = useToast();
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => { e.preventDefault(); const p = passwordProblem(pw); if (p) return setErr(p); setBusy(true); setErr('');
    try { await unwrap(api.post('/auth/reset-password', { token: sp.get('token') || '', newPassword: pw })); toast('Password updated. Please sign in.'); nav('/login'); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } };
  return <Shell title="Choose a new password"><form className="stack" onSubmit={submit} noValidate><Field label="New password" id="npw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />{err && <p className="err" role="alert">{err}</p>}<button className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Update password'}</button></form></Shell>;
}
