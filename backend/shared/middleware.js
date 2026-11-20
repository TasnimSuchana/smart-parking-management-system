'use strict';
const crypto = require('node:crypto');
const { ZodError } = require('zod');
const jwt = require('./jwt');
const { req: envReq, isProd } = require('./env');
const { AppError, unauthorized, forbidden } = require('./errors');

const ISS = 'smart-parking-auth', AUD = 'smart-parking-api';
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Reads the JWT from the HttpOnly cookie or an Authorization: Bearer header.
function authenticate({ optional = false } = {}) {
  return asyncH(async (req, _res, next) => {
    const h = req.headers.authorization;
    const token = req.cookies?.access_token || (h && h.startsWith('Bearer ') ? h.slice(7) : null);
    if (!token) { if (optional) return next(); throw unauthorized(); }
    let claims;
    try { claims = jwt.verify(token, envReq('JWT_ACCESS_SECRET', { minLength: 32 }), { iss: ISS, aud: AUD }); }
    catch { if (optional) return next(); throw unauthorized('Invalid or expired session'); }
    if (claims.typ !== 'access') throw unauthorized();
    try {
      const redis = require('./redis').get();
      if (redis && (await redis.exists(`suspended:${claims.sub}`))) throw forbidden('Account suspended');
    } catch (e) { if (e instanceof AppError) throw e; /* Redis outage: fail open, short token TTL bounds exposure */ }
    req.user = { id: claims.sub, role: claims.role };
    next();
  });
}
const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};
const adminOnly = requireRole('admin');

// CSRF: cookie-authenticated state-changing requests must echo the csrf cookie in a header.
function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.cookies?.access_token && !req.cookies?.refresh_token) return next(); // bearer / anonymous
  const c = req.cookies.csrf, h = req.headers['x-csrf-token'];
  if (!c || !h || c.length !== h.length || !crypto.timingSafeEqual(Buffer.from(c), Buffer.from(h))) {
    return next(forbidden('CSRF token missing or invalid'));
  }
  next();
}

// NoSQL injection defence: drop operator keys ($...) and dotted keys from user input.
function clean(v) {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) { if (k.startsWith('$') || k.includes('.')) continue; o[k] = clean(val); }
    return o;
  }
  return v;
}
function sanitize(req, _res, next) {
  if (req.body) req.body = clean(req.body);
  if (req.query) { const q = clean({ ...req.query }); Object.defineProperty(req, 'query', { value: q, writable: true, configurable: true }); }
  if (req.params) req.params = clean(req.params);
  next();
}

const validate = (schema, part = 'body') => (req, _res, next) => {
  const r = schema.safeParse(req[part]);
  if (!r.success) return next(r.error);
  if (part === 'query') Object.defineProperty(req, 'query', { value: r.data, writable: true, configurable: true });
  else req[part] = r.data;
  next();
};

function internalOnly(req, _res, next) {
  const k = req.headers['x-internal-key'] || '';
  const expected = envReq('INTERNAL_API_KEY', { minLength: 32 });
  if (k.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(expected))) return next(forbidden());
  next();
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Invalid input',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
  }
  if (err?.name === 'ValidationError' && err.errors) return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Invalid input' } });
  if (err?.name === 'CastError') return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid identifier' } });
  if (err?.code === 11000) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Resource already exists or time slot is taken' } });
  if (err?.type === 'entity.too.large') return res.status(413).json({ success: false, error: { code: 'TOO_LARGE', message: 'Payload too large' } });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ success: false, error: { code: 'BAD_JSON', message: 'Malformed JSON' } });
  if (err instanceof AppError) return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
  console.error(JSON.stringify({ level: 'error', msg: err?.message, path: req.path, stack: isProd() ? undefined : err?.stack }));
  res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
}
const ok = (res, data, meta, status = 200) => res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });
const page = (q) => { const p = Math.max(1, +q.page || 1), l = Math.min(100, Math.max(1, +q.limit || 20)); return { page: p, limit: l, skip: (p - 1) * l }; };
module.exports = { asyncH, authenticate, requireRole, adminOnly, csrfGuard, sanitize, validate, internalOnly, errorHandler, ok, page, ISS, AUD };
