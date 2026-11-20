'use strict';
const { z } = require('zod');
const mongoose = require('mongoose');
const { createApp, finish } = require('../../shared/app');
const { connect } = require('../../shared/db');
const { req: envReq, opt, isProd } = require('../../shared/env');
const { asyncH, authenticate, validate, internalOnly, ok, ISS, AUD } = require('../../shared/middleware');
const { bad, unauthorized, forbidden, notFound, conflict } = require('../../shared/errors');
const jwt = require('../../shared/jwt');
const pw = require('../../shared/password');
const { randomToken, sha256 } = require('../../shared/secure');
const bus = require('../../shared/bus');
const redis = require('../../shared/redis');

const ACCESS_TTL = 15 * 60, REFRESH_TTL = 7 * 24 * 3600, MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;
const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'user'], default: 'user', index: true },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  failedLogins: { type: Number, default: 0 }, lockUntil: Date,
  resetTokenHash: { type: String, select: false }, resetExpires: { type: Date, select: false },
}, { timestamps: true }));

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().max(128).refine((v) => !pw.policyError(v), { message: 'Password must be 10-128 chars with upper-case, lower-case and a number' });
const secure = () => opt('COOKIE_SECURE', isProd() ? 'true' : 'false') === 'true';
const DUMMY = pw.hash('dummy-password-for-timing'); // equalises timing for unknown emails

async function issue(res, user) {
  const access = jwt.sign({ sub: String(user._id), role: user.role, typ: 'access' }, envReq('JWT_ACCESS_SECRET', { minLength: 32 }), { expiresIn: ACCESS_TTL, iss: ISS, aud: AUD });
  const jti = randomToken(16);
  const refresh = jwt.sign({ sub: String(user._id), jti, typ: 'refresh' }, envReq('JWT_REFRESH_SECRET', { minLength: 32 }), { expiresIn: REFRESH_TTL, iss: ISS, aud: AUD });
  const r = redis.get();
  await r.set(`rt:${jti}`, String(user._id), 'EX', REFRESH_TTL);
  await r.sadd(`rtu:${user._id}`, jti); await r.expire(`rtu:${user._id}`, REFRESH_TTL);
  const base = { httpOnly: true, secure: secure(), sameSite: 'strict' };
  res.cookie('access_token', access, { ...base, path: '/', maxAge: ACCESS_TTL * 1000 });
  res.cookie('refresh_token', refresh, { ...base, path: '/api/v1/auth', maxAge: REFRESH_TTL * 1000 });
  res.cookie('csrf', randomToken(24), { httpOnly: false, secure: secure(), sameSite: 'strict', path: '/', maxAge: REFRESH_TTL * 1000 });
}
const clearCookies = (res) => { res.clearCookie('access_token', { path: '/' }); res.clearCookie('refresh_token', { path: '/api/v1/auth' }); res.clearCookie('csrf', { path: '/' }); };
async function revokeAll(userId) {
  const r = redis.get(); const ids = await r.smembers(`rtu:${userId}`);
  if (ids.length) await r.del(...ids.map((i) => `rt:${i}`));
  await r.del(`rtu:${userId}`);
}
const pub = (u) => ({ id: u._id, name: u.name, email: u.email, role: u.role, status: u.status });

(async () => {
  envReq('JWT_ACCESS_SECRET', { minLength: 32 }); envReq('JWT_REFRESH_SECRET', { minLength: 32 }); envReq('INTERNAL_API_KEY', { minLength: 32 });
  await connect('auth-service'); bus.connect().catch(() => {});
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && !(await User.exists({ role: 'admin' }))) {
    if (pw.policyError(process.env.ADMIN_PASSWORD)) throw new Error('ADMIN_PASSWORD does not meet the password policy');
    await User.create({ name: 'Administrator', email: process.env.ADMIN_EMAIL, passwordHash: await pw.hash(process.env.ADMIN_PASSWORD), role: 'admin' });
    console.log('[auth] bootstrap admin created');
  }
  const app = createApp({ name: 'auth-service' });

  app.post('/register', validate(z.object({ name: z.string().trim().min(2).max(80), email, password }).strict()), asyncH(async (req, res) => {
    if (await User.exists({ email: req.body.email })) throw conflict('An account with this email already exists');
    const u = await User.create({ name: req.body.name, email: req.body.email, passwordHash: await pw.hash(req.body.password), role: 'user' }); // role is never client-controlled
    bus.publish('user.registered', { userId: String(u._id), name: u.name, email: u.email });
    bus.auditAs(req, { id: String(u._id), role: 'user' }, 'auth.register', {});
    await issue(res, u); ok(res, pub(u), null, 201);
  }));

  app.post('/login', validate(z.object({ email, password: z.string().min(1).max(128) }).strict()), asyncH(async (req, res) => {
    const u = await User.findOne({ email: req.body.email }).select('+passwordHash');
    if (u?.lockUntil && u.lockUntil > new Date()) { bus.publish('audit.auth.locked', { action: 'auth.locked', severity: 'warn', ip: req.ip, meta: { email: req.body.email } }); throw new (require('../../shared/errors').AppError)(423, 'Account temporarily locked. Try again later.', 'LOCKED'); }
    const good = await pw.verify(req.body.password, u ? u.passwordHash : await DUMMY);
    if (!u || !good) {
      if (u) { u.failedLogins += 1; if (u.failedLogins >= MAX_FAILS) { u.lockUntil = new Date(Date.now() + LOCK_MS); u.failedLogins = 0; } await u.save(); }
      bus.publish('audit.auth.login_failed', { action: 'auth.login_failed', severity: 'warn', actorId: u ? String(u._id) : null, ip: req.ip, meta: { email: req.body.email } });
      throw unauthorized('Invalid email or password');
    }
    if (u.status !== 'active') throw forbidden('Account suspended. Contact an administrator.');
    u.failedLogins = 0; u.lockUntil = undefined; await u.save();
    bus.auditAs(req, { id: String(u._id), role: u.role }, 'auth.login', {});
    await issue(res, u); ok(res, pub(u));
  }));

  // Refresh-token rotation with reuse detection: a reused (already rotated) token revokes the whole family.
  app.post('/refresh', asyncH(async (req, res) => {
    let c; try { c = jwt.verify(req.cookies?.refresh_token, envReq('JWT_REFRESH_SECRET', { minLength: 32 }), { iss: ISS, aud: AUD }); } catch { clearCookies(res); throw unauthorized('Session expired'); }
    if (c.typ !== 'refresh') throw unauthorized();
    const r = redis.get(); const owner = await r.get(`rt:${c.jti}`);
    if (!owner) { await revokeAll(c.sub); clearCookies(res); bus.publish('audit.auth.refresh_reuse', { action: 'auth.refresh_reuse', severity: 'critical', actorId: c.sub, ip: req.ip, meta: {} }); throw unauthorized('Session invalidated'); }
    await r.del(`rt:${c.jti}`); await r.srem(`rtu:${c.sub}`, c.jti);
    const u = await User.findById(c.sub);
    if (!u || u.status !== 'active') { clearCookies(res); throw unauthorized('Session expired'); }
    await issue(res, u); ok(res, pub(u));
  }));

  app.post('/logout', asyncH(async (req, res) => {
    try { const c = jwt.verify(req.cookies?.refresh_token, envReq('JWT_REFRESH_SECRET', { minLength: 32 }), { iss: ISS, aud: AUD }); await redis.get().del(`rt:${c.jti}`); } catch { /* already invalid */ }
    clearCookies(res); ok(res, { loggedOut: true });
  }));

  app.get('/me', authenticate(), asyncH(async (req, res) => { const u = await User.findById(req.user.id); if (!u) throw unauthorized(); ok(res, pub(u)); }));

  app.post('/change-password', authenticate(), validate(z.object({ currentPassword: z.string().max(128), newPassword: password }).strict()), asyncH(async (req, res) => {
    const u = await User.findById(req.user.id).select('+passwordHash');
    if (!(await pw.verify(req.body.currentPassword, u.passwordHash))) throw unauthorized('Current password is incorrect');
    u.passwordHash = await pw.hash(req.body.newPassword); await u.save(); await revokeAll(u._id); clearCookies(res);
    bus.audit(req, 'auth.password_changed'); ok(res, { changed: true });
  }));

  // Always responds identically so the endpoint cannot be used to enumerate accounts.
  app.post('/forgot-password', validate(z.object({ email }).strict()), asyncH(async (req, res) => {
    const u = await User.findOne({ email: req.body.email });
    if (u && u.status === 'active') {
      const token = randomToken(32);
      await User.updateOne({ _id: u._id }, { resetTokenHash: sha256(token), resetExpires: new Date(Date.now() + 30 * 60 * 1000) });
      bus.publish('email.password_reset', { to: u.email, name: u.name, token });
    }
    ok(res, { message: 'If that email is registered, a reset link has been sent.' });
  }));
  app.post('/reset-password', validate(z.object({ token: z.string().min(20).max(100), newPassword: password }).strict()), asyncH(async (req, res) => {
    const u = await User.findOne({ resetTokenHash: sha256(req.body.token), resetExpires: { $gt: new Date() } }).select('+resetTokenHash +resetExpires');
    if (!u) throw bad('Reset link is invalid or has expired');
    u.passwordHash = await pw.hash(req.body.newPassword); u.resetTokenHash = undefined; u.resetExpires = undefined; u.failedLogins = 0; u.lockUntil = undefined;
    await u.save(); await revokeAll(u._id);
    bus.auditAs(req, { id: String(u._id), role: u.role }, 'auth.password_reset'); ok(res, { reset: true });
  }));

  // ---- internal (service-to-service only) ----
  app.get('/internal/users/:id', internalOnly, asyncH(async (req, res) => { const u = await User.findById(req.params.id); if (!u) throw notFound(); ok(res, pub(u)); }));
  app.patch('/internal/users/:id/status', internalOnly, validate(z.object({ status: z.enum(['active', 'suspended']) }).strict()), asyncH(async (req, res) => {
    const target = await User.findById(req.params.id); if (!target) throw notFound();
    if (target.role === 'admin') throw forbidden('Admin accounts cannot be suspended here');
    target.status = req.body.status; await target.save();
    const r = redis.get();
    if (target.status === 'suspended') { await r.set(`suspended:${target._id}`, '1', 'EX', ACCESS_TTL + 60); await revokeAll(target._id); } else await r.del(`suspended:${target._id}`);
    ok(res, pub(target));
  }));

  finish(app);
  app.listen(4001, () => console.log('[auth-service] listening on 4001'));
})().catch((e) => { console.error('[auth-service] fatal:', e.message); process.exit(1); });
