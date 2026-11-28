'use strict';
const { z } = require('zod');
const mongoose = require('mongoose');
const { createApp, finish } = require('../../shared/app');
const { connect } = require('../../shared/db');
const { asyncH, authenticate, adminOnly, validate, internalOnly: internalOnlyMw, ok, page } = require('../../shared/middleware');
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
  bookingNo: { type: String, index: true }, userId: { type: String, required: true, index: true }, vehicleId: String, plateMasked: String, vehicleType: String,
  locationId: { type: String, required: true, index: true }, slotId: { type: String, required: true }, slotLabel: String, locationName: String,
  start: { type: Date, required: true }, end: { type: Date, required: true }, buckets: [String],
  status: { type: String, enum: ['reserved', 'active', 'completed', 'cancelled', 'expired'], default: 'reserved', index: true },
  quote: mongoose.Schema.Types.Mixed, finalAmount: Number, nonce: { type: String, required: true },
  entryAt: Date, exitAt: Date, durationMinutes: Number,
}, { timestamps: true })
  .index({ buckets: 1 }, { unique: true, partialFilterExpression: { status: { $in: ACTIVE } } })
  .index({ slotId: 1, start: 1 }));

const bucketsFor = (slotId, start, end) => { const out = []; for (let t = Math.floor(start / HOUR) * HOUR; t < end; t += HOUR) out.push(`${slotId}:${t / HOUR}`); return out; };
const bookingNoOf = (b) => b.bookingNo || `SP-${String(b._id).slice(-6).toUpperCase()}`;
const newBookingNo = () => `SP-${randomToken(6).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase().padEnd(6, '7')}`;
const mine = (b) => ({ id: b._id, bookingNo: bookingNoOf(b), locationId: b.locationId, locationName: b.locationName, slotId: b.slotId, slotLabel: b.slotLabel, plateMasked: b.plateMasked, vehicleType: b.vehicleType,
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

  app.use((q, r, n) => (q.path.startsWith('/internal') ? n() : authenticate()(q, r, n))); // /internal/* is protected by internalOnly instead

  // Booked windows of a slot (no personal data); login required.
  app.get('/slot/:slotId/busy', asyncH(async (req, res) => ok(res, (await Booking.find({ slotId: req.params.slotId, status: { $in: ACTIVE }, end: { $gt: new Date() } }, 'start end').sort('start').limit(100)))));

  // Which slots of a location are already booked during [start, end)? Used by the booking wizard (no personal data).
  app.get('/availability', validate(z.object({ locationId: z.string().min(10).max(40), start: z.coerce.date(), end: z.coerce.date() }).strict().refine((v) => v.end > v.start && v.end - v.start <= 24 * HOUR, { message: 'Invalid time range' }), 'query'), asyncH(async (req, res) => {
    const { locationId, start, end } = req.query;
    const rows = await Booking.find({ locationId, status: { $in: ACTIVE }, start: { $lt: end }, end: { $gt: start } }, 'slotId').lean();
    ok(res, { bookedSlotIds: [...new Set(rows.map((r) => r.slotId))] });
  }));

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
    try { b = await Booking.create({ userId: req.user.id, vehicleId, plateMasked: vehicle.plateMasked, vehicleType: vehicle.type, locationId: String(slot.locationId), slotId, slotLabel: slot.label, locationName: slot.locationName, start, end, bookingNo: newBookingNo(), buckets: bucketsFor(slotId, start.getTime(), end.getTime()), quote, nonce: randomToken(12) }); }
    catch (e) { if (e.code === 11000) throw conflict('Sorry, this slot was just taken. Please select another slot.'); throw e; }
    // Payment record (pending). Failure here never blocks the booking; it is recreated at exit if missing.
    await call(PAYMENT, '/internal/payments', { method: 'POST', body: { bookingId: String(b._id), bookingNo: bookingNoOf(b), userId: b.userId, locationId: b.locationId, amount: quote.total, currency: quote.currency, breakdown: quote,
      snapshot: { bookingNo: bookingNoOf(b), vehicleId: b.vehicleId, plateMasked: b.plateMasked, locationName: b.locationName, slotLabel: b.slotLabel, start: b.start, end: b.end } } }).catch((e) => console.error('[booking] payment record failed', e.message));
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

  // Extend a reserved booking.
  app.post('/:id/extend', validate(z.object({
    extraHours: z.coerce.number().int().min(1).max(24),
  }).strict()), asyncH(async (req, res) => {
    const b = await Booking.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!b) throw notFound('Booking not found');
    if (b.status !== 'reserved') {
      throw conflict('Only reserved bookings can be extended');
    }
    if (b.end <= new Date()) {
      throw conflict('This booking has already ended');
    }

    const newEnd = new Date(b.end.getTime() + req.body.extraHours * HOUR);
    const newBuckets = bucketsFor(b.slotId, b.start.getTime(), newEnd.getTime());

    // Calculate the new total using the existing pricing service.
    const quote = await call(PAYMENT, '/internal/quote', {
      method: 'POST',
      body: {
        locationId: b.locationId,
        vehicleType: b.vehicleType,
        start: b.start,
        end: newEnd,
      },
    });

    let updated;
    try {
      updated = await Booking.findOneAndUpdate(
        { _id: b._id, userId: req.user.id, status: 'reserved', end: b.end },
        { $set: { end: newEnd, buckets: newBuckets, quote } },
        { new: true }
      );
    } catch (e) {
      if (e.code === 11000) {
        throw conflict('The slot is not available for the extended period');
      }
      throw e;
    }

    if (!updated) {
      throw conflict('Booking changed. Please refresh and try again.');
    }

    try {
      await call(PAYMENT, '/internal/payments', {
        method: 'POST',
        body: {
          bookingId: String(updated._id),
          bookingNo: bookingNoOf(updated),
          userId: updated.userId,
          locationId: updated.locationId,
          amount: quote.total,
          currency: quote.currency,
          breakdown: quote,
          snapshot: {
            bookingNo: bookingNoOf(updated),
            vehicleId: updated.vehicleId,
            plateMasked: updated.plateMasked,
            locationName: updated.locationName,
            slotLabel: updated.slotLabel,
            start: updated.start,
            end: updated.end,
          },
        },
      });
    } catch (e) {
      // Restore the original booking if payment update fails.
      await Booking.findOneAndUpdate(
        { _id: updated._id, end: newEnd, status: 'reserved' },
        { $set: { end: b.end, buckets: b.buckets, quote: b.quote } }
      );
      throw new AppError(503, 'Could not update payment. Please try again.', 'PAYMENT_UPDATE_FAILED');
    }

    bus.audit(req, 'booking.extended', { id: String(updated._id) });
    bus.publish('booking.extended', {
      bookingId: String(updated._id),
      userId: updated.userId,
      newEnd,
      amount: quote.total,
    });

    ok(res, mine(updated));
  }));


  // Signed, expiring QR ticket for the booking owner.
  app.get('/:id/ticket', asyncH(async (req, res) => {
    const b = await Booking.findOne({ _id: req.params.id, userId: req.user.id }); if (!b) throw notFound('Booking not found');
    if (!ACTIVE.includes(b.status)) throw conflict('Ticket is only available for active bookings');
    const exp = Math.floor(b.end.getTime() / 1000) + 15 * 60;
    ok(res, { token: signTicket({ bookingId: String(b._id), nonce: b.nonce, exp }), expiresAt: new Date(exp * 1000) });
  }));

  // ---- QR verification (admin only): checks the signature and booking state WITHOUT changing anything. ----
  const reject = (req, reason, meta = {}) => { bus.audit(req, 'qr.rejected', { reason, ...meta }, 'warn'); return { valid: false, reason, nextAction: 'none' }; };
  app.post('/verify', adminOnly, validate(z.object({ token: z.string().min(20).max(300) }).strict()), asyncH(async (req, res) => {
    let t; try { t = verifyTicket(req.body.token); } catch (e) { bus.audit(req, 'qr.invalid', { reason: e.message }, 'warn'); return ok(res, { valid: false, reason: e.message === 'ticket expired' ? 'This QR ticket is invalid or expired.' : 'This QR ticket is invalid or expired.', nextAction: 'none' }); }
    const b = await Booking.findById(t.bookingId);
    if (!b || b.nonce !== t.nonce) return ok(res, reject(req, 'This QR ticket is invalid or expired.', { bookingId: t.bookingId }));
    const now = new Date(); const pay = await call(PAYMENT, `/internal/booking/${b._id}`).catch(() => null);
    const base = { booking: { ...mine(b), bookingNo: bookingNoOf(b) }, payment: pay };
    if (b.status === 'completed') return ok(res, { ...reject(req, 'This ticket was already used for exit.', { id: String(b._id) }), ...base });
    if (b.status === 'cancelled' || b.status === 'expired') return ok(res, { ...reject(req, `This booking is ${b.status}.`, { id: String(b._id) }), ...base });
    if (pay?.status === 'refunded') return ok(res, { ...reject(req, 'This booking was refunded.', { id: String(b._id) }), ...base });
    if (b.status === 'active') {
      const billEnd = now > b.end ? now : b.end;
      const q = await call(PAYMENT, '/internal/quote', { method: 'POST', body: { locationId: b.locationId, vehicleType: b.vehicleType, start: b.start, end: billEnd } }).catch(() => null);
      bus.audit(req, 'qr.scanned', { id: String(b._id), next: 'exit' });
      return ok(res, { valid: true, nextAction: 'exit', ...base, exitPreview: { entryAt: b.entryAt, exitAt: now, durationMinutes: Math.round((now - b.entryAt) / 60000), amount: q?.total ?? null, currency: q?.currency, lines: q?.lines || [] } });
    }
    if (b.end <= now) return ok(res, { ...reject(req, 'This booking window has passed.', { id: String(b._id) }), ...base });
    if (b.start.getTime() - EARLY_ENTRY_MS > now.getTime()) return ok(res, { ...reject(req, `Too early. Entry opens at ${new Date(b.start.getTime() - EARLY_ENTRY_MS).toISOString().slice(11, 16)} UTC.`, { id: String(b._id) }), ...base });
    bus.audit(req, 'qr.scanned', { id: String(b._id), next: 'entry' });
    ok(res, { valid: true, nextAction: 'entry', ...base });
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
    await call(PAYMENT, '/internal/payments', { method: 'POST', body: { bookingId: String(u._id), bookingNo: bookingNoOf(u), userId: u.userId, locationId: u.locationId, amount: q.total, currency: q.currency, breakdown: q, snapshot: { bookingNo: bookingNoOf(u), vehicleId: u.vehicleId, plateMasked: u.plateMasked, locationName: u.locationName, slotLabel: u.slotLabel, start: u.start, end: u.end, entryAt: u.entryAt, exitAt: u.exitAt } } }).catch((e) => console.error('payment record failed', e.message));
    await call(PARKING, `/internal/slots/${u.slotId}/status`, { method: 'PATCH', body: { status: 'available' } }).catch(() => {});
    bus.audit(req, 'qr.exit', { id: String(u._id), amount: q.total });
    bus.publish('booking.exit', { bookingId: String(u._id), userId: u.userId, locationId: u.locationId, vehicleType: u.vehicleType, durationMinutes: u.durationMinutes, amount: q.total, at: now });
    ok(res, { ...mine(u), message: `Exit recorded. Final amount ${q.total} ${q.currency}` });
  }));

  // Aggregates for the analytics service (internal only). Slot-hours are counted per local hour of day and per date.
  app.get('/internal/analytics', internalOnlyMw, asyncH(async (req, res) => {
    const from = new Date(req.query.from || Date.now() - 30 * 86400000), to = new Date(req.query.to || Date.now());
    const off = (+process.env.ANALYTICS_UTC_OFFSET_HOURS || 6) * HOUR;
    const f = { start: { $lt: to }, end: { $gt: from } };
    const rows = await Booking.find(f, 'locationId slotId slotLabel locationName status start end entryAt exitAt durationMinutes finalAmount quote').limit(20000).lean();
    const status = { reserved: 0, active: 0, completed: 0, cancelled: 0, expired: 0 }, byLoc = new Map(), byHour = Array(24).fill(0), byDay = new Map(), bySlot = new Map();
    let valueSum = 0, valueN = 0, stayMin = 0, stayN = 0;
    for (const b of rows) {
      status[b.status] = (status[b.status] || 0) + 1;
      const L = byLoc.get(b.locationId) || { locationId: b.locationId, locationName: b.locationName, bookings: 0, cancelled: 0, revenue: 0, slotHours: 0, stayMin: 0, stayN: 0 }; byLoc.set(b.locationId, L);
      L.bookings++; if (b.status === 'cancelled') L.cancelled++;
      const v = b.finalAmount ?? b.quote?.total; if (v != null && b.status !== 'cancelled') { valueSum += v; valueN++; }
      if (b.status === 'completed' && b.durationMinutes) { stayMin += b.durationMinutes; stayN++; L.stayMin += b.durationMinutes; L.stayN++; L.revenue += b.finalAmount || 0; }
      if (['reserved', 'active', 'completed'].includes(b.status)) {
        const a = Math.max(+b.start, +from), z = Math.min(+(b.exitAt || b.end), +to);
        for (let t = Math.floor(a / HOUR) * HOUR; t < z; t += HOUR) {
          const local = new Date(t + off); byHour[local.getUTCHours()]++; const d = local.toISOString().slice(0, 10); byDay.set(d, (byDay.get(d) || 0) + 1); L.slotHours++;
          const sk = `${b.locationId}|${b.slotLabel}`; const S = bySlot.get(sk) || { locationName: b.locationName, slot: b.slotLabel, slotHours: 0 }; S.slotHours++; bySlot.set(sk, S);
        }
      }
    }
    ok(res, { range: { from, to }, status, total: rows.length, avgBookingValue: valueN ? Math.round((valueSum / valueN) * 100) / 100 : 0, avgStayMinutes: stayN ? Math.round(stayMin / stayN) : 0,
      byLocation: [...byLoc.values()], slotHoursByHour: byHour, slotHoursByDay: [...byDay.entries()].sort().map(([date, slotHours]) => ({ date, slotHours })),
      topSlots: [...bySlot.values()].sort((a, b) => b.slotHours - a.slotHours).slice(0, 10) });
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
