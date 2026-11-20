'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { opt, req: envReq } = require('../../shared/env');
const { url, PORTS } = require('../../shared/http');
const bus = require('../../shared/bus');

envReq('INTERNAL_API_KEY', { minLength: 32 });
const origins = opt('CORS_ORIGINS', 'http://localhost:8080').split(',').map((s) => s.trim()).filter(Boolean);
const app = express();
app.disable('x-powered-by'); app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: (o, cb) => cb(null, !o || origins.includes(o)), credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Authorization'], maxAge: 600 }));
app.get('/health', (_q, res) => res.json({ status: 'ok', service: 'api-gateway' }));

// Rate limiting; violations are written to the audit log.
const limiter = (windowMs, max, name) => rateLimit({ windowMs, limit: max, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => { bus.publish('audit.rate_limit', { action: 'rate_limit.exceeded', severity: 'warn', ip: req.ip, meta: { limiter: name, path: req.path } }); res.status(429).json({ success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests. Please try again later.' } }); } });
app.use('/api/', limiter(60_000, +opt('RATE_LIMIT_PER_MIN', '300'), 'global'));
for (const p of ['/api/v1/auth/login', '/api/v1/auth/register', '/api/v1/auth/forgot-password', '/api/v1/auth/reset-password']) app.use(p, limiter(15 * 60_000, +opt('AUTH_RATE_LIMIT', '20'), 'auth'));
app.use('/api/v1/bookings', limiter(60_000, 60, 'booking'));

// Block any attempt to reach service-internal endpoints through the public gateway and strip spoofable headers.
app.use((req, res, next) => { if (/\/internal(\/|$)/i.test(req.path)) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }); delete req.headers['x-internal-key']; next(); });

const routes = [['auth', 'auth'], ['users', 'user'], ['parking', 'parking'], ['bookings', 'booking'], ['qr', 'booking'], ['vehicles', 'vehicle'], ['payments', 'payment'],
  ['camera', 'camera'], ['monitoring', 'camera'], ['notifications', 'notification'], ['analytics', 'analytics'], ['audit', 'audit']];
for (const [path, svc] of routes) {
  const target = url(svc, PORTS[svc]);
  app.use(`/api/v1/${path}`, createProxyMiddleware({ target, changeOrigin: false, proxyTimeout: 15000, timeout: 15000, pathRewrite: { [`^/api/v1/${path}`]: path === 'monitoring' ? '/monitoring' : '' }, on: { error: (_e, _q, res) => { if (res.writeHead) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Service unavailable' } })); } } } }));
}
const ws = createProxyMiddleware({ target: url('notification', PORTS.notification), ws: true, changeOrigin: false });
app.use('/socket.io', ws);
app.use('/api', (_q, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }));
const server = app.listen(4000, () => console.log('[api-gateway] listening on 4000'));
server.on('upgrade', ws.upgrade);
bus.connect().catch(() => {});
