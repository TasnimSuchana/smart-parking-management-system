'use strict';
const { z } = require('zod');
const mongoose = require('mongoose');
const { createApp, finish } = require('../../shared/app');
const { connect } = require('../../shared/db');
const { asyncH, authenticate, adminOnly, validate, internalOnly, ok, page } = require('../../shared/middleware');
const { notFound, bad } = require('../../shared/errors');
const bus = require('../../shared/bus');

const STATUSES = ['available', 'occupied', 'reserved', 'maintenance'];
const CATS = ['standard', 'compact', 'ev', 'disabled', 'vip'];
const Location = mongoose.model('Location', new mongoose.Schema({
  name: { type: String, required: true, maxlength: 100 }, address: { type: String, required: true, maxlength: 200 }, city: { type: String, required: true, maxlength: 60, index: true },
  description: { type: String, maxlength: 600 }, phone: { type: String, maxlength: 20 }, email: { type: String, maxlength: 120 },
  lat: Number, lng: Number, active: { type: Boolean, default: true },
}, { timestamps: true }).index({ name: 'text', address: 'text', city: 'text' }));
const Slot = mongoose.model('Slot', new mongoose.Schema({
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
  label: { type: String, required: true, maxlength: 20 }, category: { type: String, enum: CATS, default: 'standard' },
  status: { type: String, enum: STATUSES, default: 'available', index: true },
}, { timestamps: true }).index({ locationId: 1, label: 1 }, { unique: true }));

const locBody = z.object({ name: z.string().trim().min(2).max(100), address: z.string().trim().min(3).max(200), city: z.string().trim().min(2).max(60),
  description: z.string().max(600).optional(), phone: z.string().regex(/^\+?[0-9 -]{6,20}$/).optional().or(z.literal('')), email: z.string().email().optional().or(z.literal('')),
  lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), active: z.boolean().optional() }).strict();
const publicSlot = (s) => ({ id: s._id, locationId: s.locationId, label: s.label, category: s.category, status: s.status });
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function setStatus(slot, status, by) {
  const prev = slot.status; slot.status = status; await slot.save();
  bus.publish('slot.updated', { slotId: String(slot._id), locationId: String(slot.locationId), label: slot.label, status, previous: prev, by });
  return slot;
}

(async () => {
  await connect('parking-service'); bus.connect().catch(() => {});
  const app = createApp({ name: 'parking-service' });

  // ---- browsing (login required: guests cannot see locations or slots) ----
  app.use(['/locations', '/slots', '/admin'], authenticate());
  app.get('/locations', asyncH(async (req, res) => {
    const { page: pg, limit, skip } = page(req.query); const f = { active: true };
    if (typeof req.query.city === 'string' && req.query.city) f.city = new RegExp(`^${esc(req.query.city.slice(0, 60))}$`, 'i');
    if (typeof req.query.q === 'string' && req.query.q) { const r = new RegExp(esc(req.query.q.slice(0, 60)), 'i'); f.$or = [{ name: r }, { address: r }, { city: r }]; }
    const [items, total] = await Promise.all([Location.find(f, '-registrars').sort('name').skip(skip).limit(limit).lean(), Location.countDocuments(f)]);
    const counts = await Slot.aggregate([{ $match: { locationId: { $in: items.map((i) => i._id) } } }, { $group: { _id: { l: '$locationId', s: '$status' }, n: { $sum: 1 } } }]);
    for (const it of items) { it.slots = { total: 0, available: 0, occupied: 0, reserved: 0, maintenance: 0 }; }
    for (const c of counts) { const it = items.find((i) => String(i._id) === String(c._id.l)); it.slots[c._id.s] = c.n; it.slots.total += c.n; }
    ok(res, items, { page: pg, limit, total });
  }));
  app.get('/locations/:id', asyncH(async (req, res) => { const l = await Location.findOne({ _id: req.params.id, active: true }, '-registrars'); if (!l) throw notFound('Location not found'); ok(res, l); }));
  app.get('/locations/:id/slots', asyncH(async (req, res) => {
    const f = { locationId: req.params.id }; if (STATUSES.includes(req.query.status)) f.status = req.query.status; if (CATS.includes(req.query.category)) f.category = req.query.category;
    ok(res, (await Slot.find(f).sort('label')).map(publicSlot));
  }));

  // ---- admin: locations ----
  app.post('/locations', authenticate(), adminOnly, validate(locBody), asyncH(async (req, res) => { const l = await Location.create(req.body); bus.audit(req, 'location.created', { id: String(l._id) }); ok(res, l, null, 201); }));
  app.put('/locations/:id', authenticate(), adminOnly, validate(locBody.partial()), asyncH(async (req, res) => { const l = await Location.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true }); if (!l) throw notFound(); bus.audit(req, 'location.updated', { id: req.params.id }); ok(res, l); }));
  app.delete('/locations/:id', authenticate(), adminOnly, asyncH(async (req, res) => { const l = await Location.findByIdAndDelete(req.params.id); if (!l) throw notFound(); await Slot.deleteMany({ locationId: l._id }); bus.audit(req, 'location.deleted', { id: req.params.id }, 'warn'); ok(res, { deleted: true }); }));
  app.get('/admin/locations', authenticate(), adminOnly, asyncH(async (_req, res) => ok(res, await Location.find().sort('name'))));

  // ---- admin: slots ----
  app.post('/locations/:id/slots', authenticate(), adminOnly, validate(z.object({ label: z.string().trim().min(1).max(20).optional(), prefix: z.string().trim().max(10).optional(), count: z.number().int().min(1).max(200).optional(), category: z.enum(CATS).default('standard') }).strict()), asyncH(async (req, res) => {
    if (!(await Location.exists({ _id: req.params.id }))) throw notFound('Location not found');
    const { label, prefix = 'S', count, category } = req.body; if (!label && !count) throw bad('Provide a label or a count');
    const docs = label ? [{ label }] : Array.from({ length: count }, (_, i) => ({ label: `${prefix}${String(i + 1).padStart(2, '0')}` }));
    const created = await Slot.insertMany(docs.map((d) => ({ ...d, category, locationId: req.params.id })), { ordered: false }).catch((e) => { if (e.code === 11000 || e.writeErrors) return e.insertedDocs || []; throw e; });
    bus.audit(req, 'slots.created', { locationId: req.params.id, count: created.length }); ok(res, created.map(publicSlot), null, 201);
  }));
  app.put('/slots/:id', authenticate(), adminOnly, validate(z.object({ label: z.string().trim().min(1).max(20).optional(), category: z.enum(CATS).optional() }).strict()), asyncH(async (req, res) => { const s = await Slot.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true }); if (!s) throw notFound(); bus.audit(req, 'slot.updated', { id: req.params.id }); ok(res, publicSlot(s)); }));
  app.delete('/slots/:id', authenticate(), adminOnly, asyncH(async (req, res) => { const s = await Slot.findByIdAndDelete(req.params.id); if (!s) throw notFound(); bus.audit(req, 'slot.deleted', { id: req.params.id }, 'warn'); ok(res, { deleted: true }); }));

  // Status update: admin only (server-side).
  app.patch('/slots/:id/status', adminOnly, validate(z.object({ status: z.enum(STATUSES) }).strict()), asyncH(async (req, res) => {
    const s = await Slot.findById(req.params.id); if (!s) throw notFound();
    await setStatus(s, req.body.status, req.user.id); bus.audit(req, 'slot.status_changed', { id: req.params.id, status: req.body.status }); ok(res, publicSlot(s));
  }));

  // ---- internal ----
  app.get('/internal/slots/:id', internalOnly, asyncH(async (req, res) => { const s = await Slot.findById(req.params.id); if (!s) throw notFound(); const l = await Location.findById(s.locationId); ok(res, { ...publicSlot(s), locationActive: !!l?.active, locationName: l?.name }); }));
  app.patch('/internal/slots/:id/status', internalOnly, validate(z.object({ status: z.enum(STATUSES), onlyIfFrom: z.array(z.enum(STATUSES)).optional() }).strict()), asyncH(async (req, res) => {
    const s = await Slot.findById(req.params.id); if (!s) throw notFound();
    if (req.body.onlyIfFrom && !req.body.onlyIfFrom.includes(s.status)) return ok(res, { ...publicSlot(s), changed: false });
    await setStatus(s, req.body.status, 'system'); ok(res, { ...publicSlot(s), changed: true });
  }));
  app.get('/internal/locations/:id/occupancy', internalOnly, asyncH(async (req, res) => {
    const [t, o] = await Promise.all([Slot.countDocuments({ locationId: req.params.id, status: { $ne: 'maintenance' } }), Slot.countDocuments({ locationId: req.params.id, status: { $in: ['occupied', 'reserved'] } })]);
    ok(res, { total: t, busy: o, pct: t ? (o / t) * 100 : 0 });
  }));
  app.get('/internal/stats', internalOnly, asyncH(async (_req, res) => {
    const g = await Slot.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]); const out = { total: 0, available: 0, occupied: 0, reserved: 0, maintenance: 0 };
    for (const r of g) { out[r._id] = r.n; out.total += r.n; } out.locations = await Location.countDocuments(); ok(res, out);
  }));
  app.get('/internal/locations/:id/slots', internalOnly, asyncH(async (req, res) => ok(res, (await Slot.find({ locationId: req.params.id })).map(publicSlot))));

  finish(app); app.listen(4003, () => console.log('[parking-service] listening on 4003'));
})().catch((e) => { console.error('[parking-service] fatal:', e.message); process.exit(1); });
