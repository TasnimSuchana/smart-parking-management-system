'use strict';
const { z } = require('zod');
const mongoose = require('mongoose');
const { createApp, finish } = require('../../shared/app');
const { connect } = require('../../shared/db');
const { asyncH, authenticate, adminOnly, validate, ok, page } = require('../../shared/middleware');
const { notFound, conflict, bad, AppError } = require('../../shared/errors');
const { signTicket, verifyTicket, randomToken } = require('../../shared/secure');
const bus = require('../../shared/bus');
const { call, url, PORTS } = require('../../shared/http');

const PARKING = url('parking', PORTS.parking), VEHICLE = url('vehicle', PORTS.vehicle), PAYMENT = url('payment', PORTS.payment);
const HOUR = 3600000, EARLY_ENTRY_MS = 15 * 60000, CANCEL_BEFORE_MS = HOUR;
const ACTIVE = ['reserved', 'active'];

// Race-safe double-booking protection: each booking claims one "slot:hour" key per hour it covers,
// and a partial UNIQUE multikey index rejects any overlapping active booking at the database level.
const Booking = mongoose.model('Booking', new mongoose.Schema({
  userId: { type: String, required: true, index: true }, vehicleId: String, plateMasked: String, vehicleType: String,
  locationId: { type: String, required: true, index: true }, slotId: { type: String, required: true }, slotLabel: String, locationName: String,
  start: { type: Date, required: true }, end: { type: Date, required: true }, buckets: [String],
  status: { type: String, enum: ['reserved', 'active', 'completed', 'cancelled', 'expired'], default: 'reserved', index: true },
  quote: mongoose.Schema.Types.Mixed, finalAmount: Number, nonce: { type: String, required: true },
  entryAt: Date, exitAt: Date, durationMinutes: Number,
}, { timestamps: true })
  .index({ buckets: 1 }, { unique: true, partialFilterExpression: { status: { $in: ACTIVE } } })
  .index({ slotId: 1, start: 1 }));

const bucketsFor = (slotId, start, end) => { const out = []; for (let t = Math.floor(start / HOUR) * HOUR; t < end; t += HOUR) out.push(`${slotId}:${t / HOUR}`); return out; };
const mine = (b) => ({ id: b._id, locationId: b.locationId, locationName: b.locationName, slotId: b.slotId, slotLabel: b.slotLabel, plateMasked: b.plateMasked, vehicleType: b.vehicleType,
  start: b.start, end: b.end, status: b.status, quote: b.quote, finalAmount: b.finalAmount, entryAt: b.entryAt, exitAt: b.exitAt, durationMinutes: b.durationMinutes });
const createBody = z.object({ slotId: z.string().min(10).max(40), vehicleId: z.string().min(10).max(40), start: z.coerce.date(), end: z.coerce.date() }).strict()
  .refine((v) => v.end - v.start >= HOUR && v.end - v.start <= 24 * HOUR, { message: 'Duration must be between 1 and 24 hours' })
  .refine((v) => v.start.getTime() >= Date.now() - 5 * 60000 && v.start.getTime() <= Date.now() + 30 * 86400000, { message: 'Start must be within the next 30 days' });

const recentByUser = new Map(); // simple per-user booking-rate tracker for abuse alerts (per instance)
function trackRate(userId) {
  const now = Date.now(), arr = (recentByUser.get(userId) || []).filter((t) => now - t < 10 * 60000); arr.push(now); recentByUser.set(userId, arr);
  if (arr.length > 6) bus.publish('alert.unusual_booking', { action: 'alert.unusual_booking', severity: 'warn', actorId: userId, meta: { bookingsIn10Min: arr.length } });
  return arr.length <= 12; // hard stop for runaway automation
}

(async () => {
  await connect('booking-service'); bus.connect().catch(() => {});
  const app = createApp({ name: 'booking-service' });

  app.use(authenticate());

  // Booked windows of a slot (no personal data); login required.
  app.get('/slot/:slotId/busy', asyncH(async (req, res) => ok(res, (await Booking.find({ slotId: req.params.slotId, status: { $in: ACTIVE }, end: { $gt: new Date() } }, 'start end').sort('start').limit(100)))));

  app.post('/', validate(createBody), asyncH(async (req, res) => {
    if (!trackRate(req.user.id)) throw new AppError(429, 'Too many bookings. Please slow down.', 'RATE_LIMIT');
    const { slotId, vehicleId, start, end } = req.body;
    const vehicle = await call(VEHICLE, `/internal/${encodeURIComponent(vehicleId)}`).catch(() => null);
    if (!vehicle || vehicle.userId !== req.user.id) throw notFound('Vehicle not found'); // ownership check, no existence leak
    const slot = await call(PARKING, `/internal/slots/${encodeURIComponent(slotId)}`).catch(() => null);
    if (!slot) throw notFound('Parking slot not found');
    if (!slot.locationActive) throw bad('This location is not accepting bookings');
    if (slot.status === 'maintenance') throw conflict('This slot is under maintenance');
    // Price is always computed server-side; the client never supplies an amount.
    const quote = await call(PAYMENT, '/internal/quote', { method: 'POST', body: { locationId: slot.locationId, vehicleType: vehicle.type, start, end } });
    let b;
    try { b = await Booking.create({ userId: req.user.id, vehicleId, plateMasked: vehicle.plateMasked, vehicleType: vehicle.type, locationId: String(slot.locationId), slotId, slotLabel: slot.label, locationName: slot.locationName, start, end, buckets: bucketsFor(slotId, start.getTime(), end.getTime()), quote, nonce: randomToken(12) }); }
    catch (e) { if (e.code === 11000) throw conflict('This slot is already booked for part of that time. Choose another time or slot.'); throw e; }
    bus.audit(req, 'booking.created', { id: String(b._id) });
    bus.publish('booking.created', { bookingId: String(b._id), userId: b.userId, locationId: b.locationId, vehicleType: b.vehicleType, slotLabel: b.slotLabel, start: b.start, end: b.end, amount: quote.total });
    ok(res, mine(b), null, 201);
  }));

  app.get('/', asyncH(async (req, res) => { const { page: pg, limit, skip } = page(req.query); const f = { userId: req.user.id };
    if (['reserved', 'active', 'completed', 'cancelled', 'expired'].includes(req.query.status)) f.status = req.query.status;
    const [items, total] = await Promise.all([Booking.find(f).sort('-start').skip(skip).limit(limit), Booking.countDocuments(f)]); ok(res, items.map(mine), { page: pg, limit, total }); }));
  // Admin: daily records for all locations.
  app.get('/daily', adminOnly, asyncH(async (req, res) => {
    const day = req.query.date ? new Date(`${String(req.query.date).slice(0, 10)}T00:00:00Z`) : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    if (Number.isNaN(day.getTime())) throw bad('Invalid date');
    const f = { start: { $lt: new Date(+day + 86400000) }, end: { $gt: day } };
    if (typeof req.query.locationId === 'string') f.locationId = req.query.locationId;
    ok(res, (await Booking.find(f).sort('start').limit(500)).map(mine));
  }));
  app.get('/:id', asyncH(async (req, res) => { const b = await Booking.findOne({ _id: req.params.id, userId: req.user.id }); if (!b) throw notFound('Booking not found'); ok(res, mine(b)); }));

  app.post('/:id/cancel', asyncH(async (req, res) => {
    const b = await Booking.findOne({ _id: req.params.id, userId: req.user.id }); if (!b) throw notFound('Booking not found');
    if (b.start.getTime() - Date.now() < CANCEL_BEFORE_MS) throw conflict('Bookings can only be cancelled at least 1 hour before the start time');
    const u = await Booking.findOneAndUpdate({ _id: b._id, status: 'reserved' }, { status: 'cancelled' }, { new: true });
    if (!u) throw conflict('This booking can no longer be cancelled');
    bus.audit(req, 'booking.cancelled', { id: String(b._id) }); bus.publish('booking.cancelled', { bookingId: String(b._id), userId: b.userId, locationId: b.locationId, slotLabel: b.slotLabel }); ok(res, mine(u));
  }));

  // Signed, expiring QR ticket for the booking owner.
  app.get('/:id/ticket', asyncH(async (req, res) => {
    const b = await Booking.findOne({ _id: req.params.id, userId: req.user.id }); if (!b) throw notFound('Booking not found');
    if (!ACTIVE.includes(b.status)) throw conflict('Ticket is only available for active bookings');
    const exp = Math.floor(b.end.getTime() / 1000) + 15 * 60;
    ok(res, { token: signTicket({ bookingId: String(b._id), nonce: b.nonce, exp }), expiresAt: new Date(exp * 1000) });
  }));

  // ---- QR scanning (admin only). Also reachable as /api/v1/qr/scan via the gateway. ----
  app.post('/scan', adminOnly, validate(z.object({ token: z.string().min(20).max(300), action: z.enum(['entry', 'exit']), paymentMethod: z.string().optional() }).strict()), asyncH(async (req, res) => {
    let t; try { t = verifyTicket(req.body.token); } catch (e) { bus.audit(req, 'qr.invalid', { reason: e.message }, 'warn'); throw bad(e.message === 'ticket expired' ? 'Ticket has expired' : 'Invalid ticket'); }
    const b = await Booking.findById(t.bookingId); if (!b || b.nonce !== t.nonce) throw bad('Invalid ticket');
    const now = new Date();
    if (req.body.action === 'entry') {
      // Atomic state transition: only the first scan can succeed, so duplicate use is rejected.
      const u = await Booking.findOneAndUpdate({ _id: b._id, status: 'reserved', start: { $lte: new Date(+now + EARLY_ENTRY_MS) }, end: { $gt: now } }, { status: 'active', entryAt: now }, { new: true });
      if (!u) { const cur = await Booking.findById(b._id); bus.audit(req, 'qr.duplicate_or_invalid_entry', { id: String(b._id), status: cur.status }, 'warn');
        throw conflict(cur.status === 'active' ? 'Ticket already used for entry' : cur.status === 'reserved' ? 'Too early or booking window has passed' : `Booking is ${cur.status}`); }
      await call(PARKING, `/internal/slots/${u.slotId}/status`, { method: 'PATCH', body: { status: 'occupied' } }).catch(() => {});
      bus.audit(req, 'qr.entry', { id: String(u._id) }); bus.publish('booking.entry', { bookingId: String(u._id), userId: u.userId, locationId: u.locationId, slotLabel: u.slotLabel, at: now });
      return ok(res, { ...mine(u), message: `Entry recorded. Slot ${u.slotLabel}` });
    }
    const cur = await Booking.findById(b._id); if (cur.status !== 'active') throw conflict(cur.status === 'completed' ? 'Ticket already used for exit' : 'Vehicle has not entered');
    const billEnd = now > cur.end ? now : cur.end; // overstay is billed; no refund for leaving early
    const q = await call(PAYMENT, '/internal/quote', { method: 'POST', body: { locationId: cur.locationId, vehicleType: cur.vehicleType, start: cur.start, end: billEnd } });
    const u = await Booking.findOneAndUpdate({ _id: cur._id, status: 'active' }, { status: 'completed', exitAt: now, durationMinutes: Math.round((now - cur.entryAt) / 60000), finalAmount: q.total }, { new: true });
    if (!u) throw conflict('Ticket already used for exit');
    await call(PAYMENT, '/internal/payments', { method: 'POST', body: { bookingId: String(u._id), userId: u.userId, locationId: u.locationId, amount: q.total, currency: q.currency, breakdown: q } }).catch((e) => console.error('payment record failed', e.message));
    await call(PARKING, `/internal/slots/${u.slotId}/status`, { method: 'PATCH', body: { status: 'available' } }).catch(() => {});
    bus.audit(req, 'qr.exit', { id: String(u._id), amount: q.total });
    bus.publish('booking.exit', { bookingId: String(u._id), userId: u.userId, locationId: u.locationId, vehicleType: u.vehicleType, durationMinutes: u.durationMinutes, amount: q.total, at: now });
    ok(res, { ...mine(u), message: `Exit recorded. Amount due ${q.total} ${q.currency}` });
  }));

  finish(app);
  // Housekeeping: reserve slots shortly before start, expire no-shows.
  setInterval(async () => {
    try {
      const now = new Date();
      for (const b of await Booking.find({ status: 'reserved', start: { $lte: new Date(+now + 30 * 60000) }, end: { $gt: now } }).limit(200))
        await call(PARKING, `/internal/slots/${b.slotId}/status`, { method: 'PATCH', body: { status: 'reserved', onlyIfFrom: ['available'] } }).catch(() => {});
      for (const b of await Booking.find({ status: 'reserved', end: { $lte: now } }).limit(200)) {
        if (await Booking.findOneAndUpdate({ _id: b._id, status: 'reserved' }, { status: 'expired' })) {
          await call(PARKING, `/internal/slots/${b.slotId}/status`, { method: 'PATCH', body: { status: 'available', onlyIfFrom: ['reserved'] } }).catch(() => {});
          bus.publish('booking.expired', { bookingId: String(b._id), userId: b.userId, locationId: b.locationId });
        }
      }
    } catch (e) { console.error('[booking] housekeeping', e.message); }
  }, 60000).unref();
  app.listen(4004, () => console.log('[booking-service] listening on 4004'));
})().catch((e) => { console.error('[booking-service] fatal:', e.message); process.exit(1); });
