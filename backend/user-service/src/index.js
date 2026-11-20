'use strict';
const { z } = require('zod');
const mongoose = require('mongoose');
const { createApp, finish } = require('../../shared/app');
const { connect } = require('../../shared/db');
const { asyncH, authenticate, adminOnly, validate, internalOnly, ok, page } = require('../../shared/middleware');
const { notFound } = require('../../shared/errors');
const bus = require('../../shared/bus');
const { call, url, PORTS } = require('../../shared/http');

const Profile = mongoose.model('Profile', new mongoose.Schema({
  userId: { type: String, required: true, unique: true }, name: { type: String, maxlength: 80 },
  email: { type: String, index: true }, phone: { type: String, maxlength: 20 }, role: { type: String, default: 'user' },
}, { timestamps: true }));
const AUTH = url('auth', PORTS.auth);
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

(async () => {
  await connect('user-service');
  await bus.subscribe('user-service.events', ['user.registered'], async (_k, m) => {
    await Profile.updateOne({ userId: m.userId }, { $setOnInsert: { userId: m.userId, name: m.name, email: m.email } }, { upsert: true });
  });
  const app = createApp({ name: 'user-service' });

  app.get('/me', authenticate(), asyncH(async (req, res) => {
    const p = await Profile.findOne({ userId: req.user.id }); if (!p) throw notFound('Profile not found'); ok(res, p);
  }));
  app.put('/me', authenticate(), validate(z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().regex(/^\+?[0-9 -]{6,20}$/).optional().or(z.literal('')) }).strict()), asyncH(async (req, res) => {
    const p = await Profile.findOneAndUpdate({ userId: req.user.id }, { $set: req.body }, { new: true }); if (!p) throw notFound(); ok(res, p);
  }));

  // ---- admin ----
  app.get('/', authenticate(), adminOnly, asyncH(async (req, res) => {
    const { page: pg, limit, skip } = page(req.query); const f = {};
    if (['user', 'admin'].includes(req.query.role)) f.role = req.query.role;
    if (typeof req.query.q === 'string' && req.query.q) { const r = new RegExp(esc(req.query.q.slice(0, 50)), 'i'); f.$or = [{ name: r }, { email: r }]; }
    const [items, total] = await Promise.all([Profile.find(f).sort('-createdAt').skip(skip).limit(limit), Profile.countDocuments(f)]);
    ok(res, items, { page: pg, limit, total });
  }));
  app.patch('/:id/status', authenticate(), adminOnly, validate(z.object({ status: z.enum(['active', 'suspended']) }).strict()), asyncH(async (req, res) => {
    const r = await call(AUTH, `/internal/users/${encodeURIComponent(req.params.id)}/status`, { method: 'PATCH', body: req.body });
    bus.audit(req, 'user.status_changed', { target: req.params.id, status: req.body.status }, 'warn'); ok(res, r);
  }));
  app.get('/internal/:id', internalOnly, asyncH(async (req, res) => { const p = await Profile.findOne({ userId: req.params.id }); if (!p) throw notFound(); ok(res, { name: p.name, email: p.email }); }));

  finish(app); app.listen(4002, () => console.log('[user-service] listening on 4002'));
})().catch((e) => { console.error('[user-service] fatal:', e.message); process.exit(1); });
