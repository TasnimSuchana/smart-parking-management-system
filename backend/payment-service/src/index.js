'use strict';
const { z } = require('zod');
const mongoose = require('mongoose');
const { createApp, finish } = require('../../shared/app');
const { connect } = require('../../shared/db');
const { asyncH, authenticate, adminOnly, validate, internalOnly, ok, page } = require('../../shared/middleware');
const { notFound, bad } = require('../../shared/errors');
const pricing = require('../../shared/pricing');
const bus = require('../../shared/bus');
const { call, url, PORTS } = require('../../shared/http');

const PARKING = url('parking', PORTS.parking);
const Rule = mongoose.model('PricingRule', new mongoose.Schema({
  locationId: { type: String, default: 'default', unique: true },
  rule: { type: mongoose.Schema.Types.Mixed, required: true }, updatedBy: String,
}, { timestamps: true }));
const Payment = mongoose.model('Payment', new mongoose.Schema({
  bookingId: { type: String, required: true, unique: true }, userId: { type: String, index: true }, locationId: { type: String, index: true },
  amount: { type: Number, required: true, min: 0 }, currency: String, breakdown: mongoose.Schema.Types.Mixed,
  status: { type: String, enum: ['pending', 'paid', 'refunded'], default: 'pending', index: true },
  method: { type: String, enum: ['cash', 'card_terminal', 'mobile_banking', 'other'] }, paidAt: Date, recordedBy: String,
}, { timestamps: true }));

const ruleSchema = z.object({
  currency: z.string().length(3), baseHourly: z.number().positive().max(100000), dailyRate: z.number().positive().max(1000000),
  vehicleMultipliers: z.record(z.enum(['car', 'bike', 'suv', 'truck', 'ev']), z.number().positive().max(10)),
  utcOffsetMinutes: z.number().int().min(-720).max(840),
  peak: z.array(z.object({ startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(1).max(24), multiplier: z.number().min(1).max(5) })).max(8),
  demand: z.array(z.object({ minOccupancy: z.number().min(0).max(100), multiplier: z.number().min(1).max(5) })).max(6),
}).strict();
async function ruleFor(locationId) {
  const r = (locationId && (await Rule.findOne({ locationId: String(locationId) }))) || (await Rule.findOne({ locationId: 'default' }));
  return r?.rule || pricing.DEFAULT_RULE;
}
async function quote({ locationId, vehicleType, start, end }) {
  let occ = 0; if (locationId) { try { occ = (await call(PARKING, `/internal/locations/${encodeURIComponent(locationId)}/occupancy`)).pct; } catch { occ = 0; } }
  return pricing.calculate({ rule: await ruleFor(locationId), vehicleType, start, end, occupancyPct: occ });
}
const quoteBody = z.object({ locationId: z.string().max(40).optional(), vehicleType: z.enum(['car', 'bike', 'suv', 'truck', 'ev']), start: z.coerce.date(), end: z.coerce.date() }).strict()
  .refine((v) => v.end > v.start && v.end - v.start <= 7 * 86400000, { message: 'End must be after start (max 7 days)' });

(async () => {
  await connect('payment-service'); bus.connect().catch(() => {});
  const app = createApp({ name: 'payment-service' });

  // Pricing and quotes require login (guests cannot see them).
  app.get('/pricing', authenticate(), asyncH(async (req, res) => ok(res, await ruleFor(typeof req.query.locationId === 'string' ? req.query.locationId : null))));
  app.post('/quote', authenticate(), validate(quoteBody), asyncH(async (req, res) => ok(res, await quote(req.body))));
  app.put('/pricing', authenticate(), adminOnly, validate(z.object({ locationId: z.string().max(40).default('default'), rule: ruleSchema })), asyncH(async (req, res) => {
    const r = await Rule.findOneAndUpdate({ locationId: req.body.locationId }, { rule: req.body.rule, updatedBy: req.user.id }, { upsert: true, new: true });
    bus.audit(req, 'pricing.updated', { locationId: req.body.locationId }, 'warn'); ok(res, r);
  }));

  app.get('/me', authenticate(), asyncH(async (req, res) => { const { page: pg, limit, skip } = page(req.query); const f = { userId: req.user.id };
    const [items, total] = await Promise.all([Payment.find(f).sort('-createdAt').skip(skip).limit(limit), Payment.countDocuments(f)]); ok(res, items, { page: pg, limit, total }); }));
  app.get('/', authenticate(), adminOnly, asyncH(async (req, res) => { const { page: pg, limit, skip } = page(req.query); const f = {};
    if (['pending', 'paid', 'refunded'].includes(req.query.status)) f.status = req.query.status;
    const [items, total] = await Promise.all([Payment.find(f).sort('-createdAt').skip(skip).limit(limit), Payment.countDocuments(f)]); ok(res, items, { page: pg, limit, total }); }));
  app.get('/pending', authenticate(), adminOnly, asyncH(async (req, res) => ok(res, await Payment.find({ status: 'pending' }).sort('-createdAt').limit(100))));
  // Payment gateway: none is integrated (needs merchant credentials). Admin records on-site settlement.
  app.patch('/:id/paid', authenticate(), adminOnly, validate(z.object({ method: z.enum(['cash', 'card_terminal', 'mobile_banking', 'other']) }).strict()), asyncH(async (req, res) => {
    const p = await Payment.findById(req.params.id); if (!p) throw notFound();
    const upd = await Payment.findOneAndUpdate({ _id: p._id, status: 'pending' }, { status: 'paid', method: req.body.method, paidAt: new Date(), recordedBy: req.user.id }, { new: true });
    if (!upd) throw bad('Payment already settled');
    bus.publish('payment.recorded', { paymentId: String(upd._id), amount: upd.amount, locationId: upd.locationId, userId: upd.userId, method: upd.method });
    bus.audit(req, 'payment.paid', { id: String(upd._id), amount: upd.amount }); ok(res, upd);
  }));

  app.post('/internal/quote', internalOnly, validate(quoteBody), asyncH(async (req, res) => ok(res, await quote(req.body))));
  app.post('/internal/payments', internalOnly, asyncH(async (req, res) => {
    const b = req.body; const p = await Payment.findOneAndUpdate({ bookingId: String(b.bookingId) }, { $setOnInsert: { bookingId: String(b.bookingId), userId: b.userId, locationId: b.locationId, amount: Number(b.amount), currency: b.currency, breakdown: b.breakdown } }, { upsert: true, new: true });
    ok(res, p, null, 201);
  }));
  finish(app); app.listen(4006, () => console.log('[payment-service] listening on 4006'));
})().catch((e) => { console.error('[payment-service] fatal:', e.message); process.exit(1); });
