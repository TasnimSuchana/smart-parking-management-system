'use strict';
const mongoose = require('mongoose');
const { createApp, finish } = require('../../shared/app');
const { connect } = require('../../shared/db');
const { asyncH, authenticate, adminOnly, ok, page } = require('../../shared/middleware');
const bus = require('../../shared/bus');

const Log = mongoose.model('AuditLog', new mongoose.Schema({
  action: { type: String, index: true }, actorId: { type: String, index: true }, actorRole: String, ip: String,
  severity: { type: String, enum: ['info', 'warn', 'critical'], default: 'info', index: true }, meta: mongoose.Schema.Types.Mixed, at: { type: Date, default: Date.now, index: true },
}).index({ at: 1 }, { expireAfterSeconds: 365 * 86400 })); // retain one year

const failures = new Map(); // key -> timestamps; brute-force detection (per instance)
function bruteForce(key, ip, meta) {
  const now = Date.now(), arr = (failures.get(key) || []).filter((t) => now - t < 10 * 60000); arr.push(now); failures.set(key, arr);
  if (arr.length === 5) bus.publish('alert.suspicious_activity', { action: 'alert.brute_force', severity: 'critical', ip, meta: { ...meta, failuresIn10Min: arr.length } });
}
// Sensitive keys are never stored in log metadata.
const scrub = (m) => { if (!m || typeof m !== 'object') return m; const o = {}; for (const [k, v] of Object.entries(m)) { if (/pass|token|secret|authorization/i.test(k)) continue; o[k] = v; } return o; };

(async () => {
  await connect('audit-service');
  await bus.subscribe('audit-service.events', ['audit.#', 'alert.#'], async (key, m) => {
    await Log.create({ action: m.action || key, actorId: m.actorId, actorRole: m.actorRole, ip: m.ip, severity: m.severity || 'info', meta: scrub(m.meta), at: m._at });
    if (key === 'audit.auth.login_failed') bruteForce(m.meta?.email || m.ip, m.ip, { email: m.meta?.email });
    if (key.startsWith('alert.')) bus.publish('notify.admin_alert', { title: 'Security alert', message: `${m.action}: ${JSON.stringify(scrub(m.meta)).slice(0, 200)}`, severity: m.severity });
  });
  const app = createApp({ name: 'audit-service' });
  app.use(authenticate(), adminOnly);
  app.get('/logs', asyncH(async (req, res) => {
    const { page: pg, limit, skip } = page(req.query); const f = {};
    if (['info', 'warn', 'critical'].includes(req.query.severity)) f.severity = req.query.severity;
    if (['admin', 'user', 'guest'].includes(req.query.role)) f.actorRole = req.query.role;
    if (typeof req.query.action === 'string' && /^[\w.]{1,60}$/.test(req.query.action)) f.action = { $regex: `^${req.query.action.replace(/\./g, '\\.')}` };
    const [items, total] = await Promise.all([Log.find(f).sort('-at').skip(skip).limit(limit), Log.countDocuments(f)]); ok(res, items, { page: pg, limit, total });
  }));
  app.get('/summary', asyncH(async (_req, res) => {
    const since = new Date(Date.now() - 24 * 3600000);
    const [failed, alerts, locks, byAction] = await Promise.all([Log.countDocuments({ action: 'auth.login_failed', at: { $gte: since } }), Log.countDocuments({ action: /^alert\./, at: { $gte: since } }), Log.countDocuments({ action: 'auth.locked', at: { $gte: since } }),
      Log.aggregate([{ $match: { at: { $gte: since } } }, { $group: { _id: '$action', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }])]);
    ok(res, { failedLogins24h: failed, alerts24h: alerts, lockouts24h: locks, topActions: byAction });
  }));
  finish(app); app.listen(4010, () => console.log('[audit-service] listening on 4010'));
})().catch((e) => { console.error('[audit-service] fatal:', e.message); process.exit(1); });
