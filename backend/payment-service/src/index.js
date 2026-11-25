'use strict';
const crypto = require('node:crypto');
const { z } = require('zod');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const { createApp, finish } = require('../../shared/app');
const { connect } = require('../../shared/db');
const { opt } = require('../../shared/env');
const { asyncH, authenticate, adminOnly, validate, internalOnly, ok, page } = require('../../shared/middleware');
const { notFound, bad, forbidden, conflict } = require('../../shared/errors');
const pricing = require('../../shared/pricing');
const bus = require('../../shared/bus');
const { call, url, PORTS } = require('../../shared/http');

const PARKING = url('parking', PORTS.parking), USERS = url('user', PORTS.user), VEHICLES = url('vehicle', PORTS.vehicle);
const METHODS = ['cash', 'card_terminal', 'mobile_banking', 'demo', 'other'];
const STATUSES = ['pending', 'paid', 'failed', 'refunded'];
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const demoEnabled = () => opt('ENABLE_DEMO_PAYMENT', 'false') === 'true';
const newTxnId = () => `TXN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const newInvoiceNo = () => `INV-${new Date().getUTCFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const Rule = mongoose.model('PricingRule', new mongoose.Schema({
  locationId: { type: String, default: 'default', unique: true },
  rule: { type: mongoose.Schema.Types.Mixed, required: true }, updatedBy: String,
}, { timestamps: true }));

// One payment per booking. `amount` is what is currently due in total; `paidAmount` is what has been settled.
// No real payment gateway is integrated: status only becomes "paid" through the admin (on-site settlement)
// or the clearly-labelled TEST payment (method "demo", enabled with ENABLE_DEMO_PAYMENT=true).
const Payment = mongoose.model('Payment', new mongoose.Schema({
  bookingId: { type: String, required: true, unique: true }, bookingNo: String, userId: { type: String, index: true }, locationId: { type: String, index: true },
  amount: { type: Number, required: true, min: 0 }, paidAmount: { type: Number, default: 0 }, currency: String, breakdown: mongoose.Schema.Types.Mixed,
  status: { type: String, enum: STATUSES, default: 'pending', index: true }, method: { type: String, enum: METHODS },
  transactionId: { type: String, index: true }, invoiceNo: String, paidAt: Date, recordedBy: String, failureReason: String, snapshot: mongoose.Schema.Types.Mixed,
}, { timestamps: true }));

const view = (p) => ({
  id: p._id, bookingId: p.bookingId, bookingNo: p.bookingNo || p.snapshot?.bookingNo, userId: p.userId, locationId: p.locationId,
  amount: p.amount, paidAmount: p.paidAmount || 0, outstanding: Math.max(0, Math.round((p.amount - (p.paidAmount || 0)) * 100) / 100), currency: p.currency,
  status: p.status, method: p.method, transactionId: p.transactionId || `TXN-${String(p._id).slice(-8).toUpperCase()}`, invoiceNo: p.invoiceNo || `INV-${String(p._id).slice(-8).toUpperCase()}`,
  paidAt: p.paidAt, createdAt: p.createdAt, failureReason: p.failureReason, breakdown: p.breakdown, snapshot: p.snapshot,
});

const ruleSchema = z.object({
  currency: z.string().length(3), baseHourly: z.number().positive().max(100000), dailyRate: z.number().positive().max(1000000),
  vehicleMultipliers: z.record(z.enum(['car', 'bike', 'suv', 'truck', 'ev']), z.number().positive().max(10)),
  utcOffsetMinutes: z.number().int().min(-720).max(840),
  peak: z.array(z.object({ startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(1).max(24), multiplier: z.number().min(1).max(5) })).max(8),
  demand: z.array(z.object({ minOccupancy: z.number().min(0).max(100), multiplier: z.number().min(1).max(5) })).max(6),
  serviceFee: z.number().min(0).max(100000).optional(), discountPercent: z.number().min(0).max(100).optional(),
}).strict();
async function ruleFor(locationId) {
  const r = (locationId && (await Rule.findOne({ locationId: String(locationId) }))) || (await Rule.findOne({ locationId: 'default' }));
  return { ...pricing.DEFAULT_RULE, ...(r?.rule || {}) };
}
async function quote({ locationId, vehicleType, start, end }) {
  let occ = 0; if (locationId) { try { occ = (await call(PARKING, `/internal/locations/${encodeURIComponent(locationId)}/occupancy`)).pct; } catch { occ = 0; } }
  return pricing.calculate({ rule: await ruleFor(locationId), vehicleType, start, end, occupancyPct: occ });
}
const quoteBody = z.object({ locationId: z.string().max(40).optional(), vehicleType: z.enum(['car', 'bike', 'suv', 'truck', 'ev']), start: z.coerce.date(), end: z.coerce.date() }).strict()
  .refine((v) => v.end > v.start && v.end - v.start <= 7 * 86400000, { message: 'End must be after start (max 7 days)' });

const settle = async (filter, set, unset) => Payment.findOneAndUpdate(filter, unset ? { $set: set, $unset: unset } : { $set: set }, { new: true });
function announcePaid(p, delta) { bus.publish('payment.recorded', { paymentId: String(p._id), amount: delta, locationId: p.locationId, userId: p.userId, method: p.method }); }

(async () => {
  await connect('payment-service'); bus.connect().catch(() => {});
  const app = createApp({ name: 'payment-service' });

  // Pricing, quotes and config need a login (guests cannot see them).
  app.get('/config', authenticate(), (_q, res) => ok(res, { demoPaymentEnabled: demoEnabled(), gateway: null, methods: METHODS }));
  app.get('/pricing', authenticate(), asyncH(async (req, res) => ok(res, await ruleFor(typeof req.query.locationId === 'string' ? req.query.locationId : null))));
  app.get('/pricing/summary', authenticate(), asyncH(async (_q, res) => {
    const all = await Rule.find().lean(); const pick = (r) => ({ currency: r.currency, baseHourly: r.baseHourly, dailyRate: r.dailyRate, vehicleMultipliers: r.vehicleMultipliers, serviceFee: r.serviceFee || 0, discountPercent: r.discountPercent || 0 });
    const out = { default: pick({ ...pricing.DEFAULT_RULE, ...(all.find((x) => x.locationId === 'default')?.rule || {}) }), locations: {} };
    for (const x of all) if (x.locationId !== 'default') out.locations[x.locationId] = pick({ ...pricing.DEFAULT_RULE, ...x.rule }); ok(res, out);
  }));
  app.post('/quote', authenticate(), validate(quoteBody), asyncH(async (req, res) => ok(res, await quote(req.body))));
  app.put('/pricing', authenticate(), adminOnly, validate(z.object({ locationId: z.string().max(40).default('default'), rule: ruleSchema })), asyncH(async (req, res) => {
    const r = await Rule.findOneAndUpdate({ locationId: req.body.locationId }, { rule: req.body.rule, updatedBy: req.user.id }, { upsert: true, new: true });
    bus.audit(req, 'pricing.updated', { locationId: req.body.locationId }, 'warn'); ok(res, r);
  }));

  // ---- user ----
  app.get('/me', authenticate(), asyncH(async (req, res) => { const { page: pg, limit, skip } = page(req.query); const f = { userId: req.user.id };
    if (typeof req.query.bookingId === 'string') f.bookingId = req.query.bookingId; if (STATUSES.includes(req.query.status)) f.status = req.query.status;
    const [items, total] = await Promise.all([Payment.find(f).sort('-createdAt').skip(skip).limit(limit), Payment.countDocuments(f)]); ok(res, items.map(view), { page: pg, limit, total }); }));

  // TEST payment: records a successful or failed *simulated* payment. Never real money, never a real gateway.
  app.post('/demo-pay', authenticate(), validate(z.object({ bookingId: z.string().min(10).max(40), outcome: z.enum(['success', 'fail']).default('success') }).strict()), asyncH(async (req, res) => {
    if (!demoEnabled()) throw forbidden('Test payments are disabled on this server');
    const p = await Payment.findOne({ bookingId: req.body.bookingId, userId: req.user.id }); if (!p) throw notFound('Payment not found');
    if (!['pending', 'failed'].includes(p.status)) throw conflict('This payment is already settled');
    if (req.body.outcome === 'fail') {
      const f = await settle({ _id: p._id, status: { $in: ['pending', 'failed'] } }, { status: 'failed', method: 'demo', failureReason: 'Simulated test failure' });
      bus.audit(req, 'payment.failed', { id: String(p._id), test: true }, 'warn'); return ok(res, view(f || p));
    }
    const upd = await settle({ _id: p._id, status: { $in: ['pending', 'failed'] } }, { status: 'paid', method: 'demo', paidAmount: p.amount, paidAt: new Date(), recordedBy: req.user.id, transactionId: p.transactionId || newTxnId() }, { failureReason: 1 });
    if (!upd) throw conflict('This payment is already settled');
    announcePaid(upd, p.amount - (p.paidAmount || 0)); bus.audit(req, 'payment.paid', { id: String(upd._id), amount: upd.amount, test: true }); ok(res, view(upd));
  }));

  // ---- admin ----
  app.get('/', authenticate(), adminOnly, asyncH(async (req, res) => { const { page: pg, limit, skip } = page(req.query); const f = {};
    if (STATUSES.includes(req.query.status)) f.status = req.query.status; if (METHODS.includes(req.query.method)) f.method = req.query.method;
    if (typeof req.query.q === 'string' && req.query.q.trim()) { const r = new RegExp(esc(req.query.q.trim().slice(0, 40)), 'i'); f.$or = [{ transactionId: r }, { bookingNo: r }, { invoiceNo: r }, { bookingId: r }]; }
    const [items, total] = await Promise.all([Payment.find(f).sort('-createdAt').skip(skip).limit(limit), Payment.countDocuments(f)]); ok(res, items.map(view), { page: pg, limit, total }); }));
  app.get('/pending', authenticate(), adminOnly, asyncH(async (_req, res) => ok(res, (await Payment.find({ status: { $in: ['pending', 'failed'] } }).sort('-createdAt').limit(100)).map(view))));
  // Admin records on-site settlement (cash / card terminal / mobile banking). This is the only non-test way a payment becomes "paid".
  app.patch('/:id/paid', authenticate(), adminOnly, validate(z.object({ method: z.enum(['cash', 'card_terminal', 'mobile_banking', 'other']) }).strict()), asyncH(async (req, res) => {
    const p = await Payment.findById(req.params.id); if (!p) throw notFound();
    const upd = await settle({ _id: p._id, status: { $in: ['pending', 'failed'] } }, { status: 'paid', method: req.body.method, paidAmount: p.amount, paidAt: new Date(), recordedBy: req.user.id, transactionId: p.transactionId || newTxnId() });
    if (!upd) throw bad('Payment already settled');
    announcePaid(upd, p.amount - (p.paidAmount || 0)); bus.audit(req, 'payment.paid', { id: String(upd._id), amount: upd.amount }); ok(res, view(upd));
  }));

  // ---- detail + invoice (owner or admin) ----
  const loadOwned = async (req) => { const p = await Payment.findById(req.params.id); if (!p || (req.user.role !== 'admin' && p.userId !== req.user.id)) throw notFound('Transaction not found'); return p; };
  app.get('/:id', authenticate(), asyncH(async (req, res) => ok(res, view(await loadOwned(req)))));
  app.get('/:id/invoice', authenticate(), asyncH(async (req, res) => {
    const p = await loadOwned(req); const v = view(p); const sn = p.snapshot || {};
    const [user, vehicle] = await Promise.all([call(USERS, `/internal/${encodeURIComponent(p.userId)}`).catch(() => null), sn.vehicleId ? call(VEHICLES, `/internal/${encodeURIComponent(sn.vehicleId)}`).catch(() => null) : null]);
    const money = (n) => `${p.currency || 'BDT'} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const when = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '-');
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${v.invoiceNo}.pdf"`); res.setHeader('Cache-Control', 'no-store');
    const doc = new PDFDocument({ margin: 50 }); doc.pipe(res);
    doc.fontSize(24).fillColor('#0b7285').text('SMARTPARK', { continued: false }); doc.fontSize(10).fillColor('#555').text('Parking invoice').moveDown(0.8);
    doc.fillColor('#000').fontSize(11);
    const rows = [['Invoice number', v.invoiceNo], ['Date', when(p.paidAt || p.createdAt)], ['Booking ID', v.bookingNo || v.bookingId], ['Customer', user?.name || '-'], ['Vehicle', vehicle?.plate || sn.plateMasked || '-'],
      ['Parking location', sn.locationName || '-'], ['Slot', sn.slotLabel || '-'], ['Entry time', when(sn.entryAt || sn.start)], ['Exit time', when(sn.exitAt || sn.end)]];
    for (const [k, val] of rows) { doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(String(val)); }
    doc.moveDown().font('Helvetica-Bold').fontSize(13).text('Charges').font('Helvetica').fontSize(11).moveDown(0.3);
    const lines = p.breakdown?.lines?.length ? p.breakdown.lines : [{ label: 'Parking charge', amount: p.amount }];
    for (const l of lines) { const y = doc.y; doc.text(l.label, 50, y); doc.text(money(l.amount), 350, y, { width: 190, align: 'right' }); }
    doc.moveDown(0.5).moveTo(50, doc.y).lineTo(540, doc.y).strokeColor('#999').stroke().moveDown(0.5);
    const y = doc.y; doc.font('Helvetica-Bold').text('Total', 50, y); doc.text(money(p.amount), 350, y, { width: 190, align: 'right' }); doc.font('Helvetica').moveDown(1.2);
    for (const [k, val] of [['Payment status', v.status.toUpperCase()], ['Payment method', p.method ? p.method.replace('_', ' ') : '-'], ['Transaction ID', v.transactionId], ['Amount paid', money(v.paidAmount)]]) doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(String(val));
    if (p.method === 'demo') doc.moveDown().fillColor('#b45309').text('TEST PAYMENT: this was a simulated payment. No real money was transferred.');
    if (v.status !== 'paid') doc.moveDown().fillColor('#555').text('This invoice is not yet paid.');
    doc.end();
  }));

  // ---- internal ----
  app.post('/internal/quote', internalOnly, validate(quoteBody), asyncH(async (req, res) => ok(res, await quote(req.body))));
  // Create (at booking) or update (at exit) the payment for a booking. Never marks a payment as paid.
  app.post('/internal/payments', internalOnly, asyncH(async (req, res) => {
    const b = req.body; const bid = String(b.bookingId); const amount = b.amount != null ? Number(b.amount) : undefined;
    if (amount != null && !(amount >= 0)) throw bad('Invalid amount');
    let p = await Payment.findOne({ bookingId: bid });
    if (!p) { p = await Payment.create({ bookingId: bid, bookingNo: b.bookingNo, userId: b.userId, locationId: b.locationId, amount: amount ?? 0, currency: b.currency, breakdown: b.breakdown, transactionId: newTxnId(), invoiceNo: newInvoiceNo(), snapshot: b.snapshot || {} }); return ok(res, view(p), null, 201); }
    const set = {}; if (amount != null) { set.amount = amount; set.breakdown = b.breakdown; set.currency = b.currency || p.currency; }
    if (b.snapshot) set.snapshot = { ...(p.snapshot || {}), ...b.snapshot };
    if (amount != null && p.status !== 'refunded') { if ((p.paidAmount || 0) > 0 && p.paidAmount >= amount) set.status = 'paid'; else if (p.status === 'paid') set.status = 'pending'; }
    ok(res, view(await Payment.findByIdAndUpdate(p._id, { $set: set }, { new: true })));
  }));
  app.get('/internal/booking/:id', internalOnly, asyncH(async (req, res) => { const p = await Payment.findOne({ bookingId: req.params.id }); ok(res, p ? { status: p.status, method: p.method, amount: p.amount, paidAmount: p.paidAmount || 0, transactionId: view(p).transactionId } : null); }));
  app.get('/internal/analytics', internalOnly, asyncH(async (req, res) => {
    const from = new Date(req.query.from || Date.now() - 30 * 86400000), to = new Date(req.query.to || Date.now());
    const m = { status: 'paid', paidAt: { $gte: from, $lte: to } };
    const [byLocation, byMethod, byStatus, avg] = await Promise.all([
      Payment.aggregate([{ $match: m }, { $group: { _id: '$locationId', revenue: { $sum: '$paidAmount' }, transactions: { $sum: 1 } } }]),
      Payment.aggregate([{ $match: m }, { $group: { _id: '$method', revenue: { $sum: '$paidAmount' }, transactions: { $sum: 1 } } }]),
      Payment.aggregate([{ $match: { createdAt: { $gte: from, $lte: to } } }, { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
      Payment.aggregate([{ $match: { createdAt: { $gte: from, $lte: to } } }, { $group: { _id: null, v: { $avg: '$amount' } } }]),
    ]);
    ok(res, { byLocation, byMethod, byStatus, avgBookingValue: Math.round((avg[0]?.v || 0) * 100) / 100 });
  }));
  finish(app); app.listen(4006, () => console.log('[payment-service] listening on 4006'));
})().catch((e) => { console.error('[payment-service] fatal:', e.message); process.exit(1); });
