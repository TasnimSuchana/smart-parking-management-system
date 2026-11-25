'use strict';
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const { createApp, finish } = require('../../shared/app');
const { connect } = require('../../shared/db');
const { asyncH, authenticate, adminOnly, ok } = require('../../shared/middleware');
const { bad } = require('../../shared/errors');
const bus = require('../../shared/bus');
const { call, url, PORTS } = require('../../shared/http');

// Event-sourced facts: this service owns its own data and never reads other services' databases.
const Fact = mongoose.model('Fact', new mongoose.Schema({
  type: { type: String, enum: ['booking', 'entry', 'exit', 'cancel', 'payment'], index: true }, locationId: { type: String, index: true },
  vehicleType: String, amount: Number, durationMinutes: Number, at: { type: Date, index: true },
}));
const PARKING = url('parking', PORTS.parking), BOOKING = url('booking', PORTS.booking), PAYMENT = url('payment', PORTS.payment);
const TZ_OFFSET_H = +(process.env.ANALYTICS_UTC_OFFSET_HOURS || 6);
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; // blocks CSV formula injection

async function revenue(period, from, to) {
  const fmt = period === 'monthly' ? '%Y-%m' : period === 'weekly' ? '%G-W%V' : '%Y-%m-%d';
  const since = from || daysAgo(period === 'monthly' ? 365 : period === 'weekly' ? 120 : 30);
  return Fact.aggregate([{ $match: { type: 'payment', at: { $gte: since, ...(to ? { $lte: to } : {}) } } }, { $group: { _id: { $dateToString: { format: fmt, date: '$at', timezone: `+0${TZ_OFFSET_H}:00` } }, revenue: { $sum: '$amount' }, transactions: { $sum: 1 } } }, { $sort: { _id: 1 } }])
    .then((r) => r.map((x) => ({ period: x._id, revenue: Math.round(x.revenue * 100) / 100, transactions: x.transactions })));
}

// ---- Date range parsing: ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive); defaults to the last 30 days. ----
function parseRange(q) {
  const ok1 = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const to = ok1(q.to) ? new Date(`${q.to}T23:59:59.999Z`) : new Date(); const from = ok1(q.from) ? new Date(`${q.from}T00:00:00.000Z`) : new Date(+to - 30 * 86400000);
  if (Number.isNaN(+from) || Number.isNaN(+to) || to < from) throw bad('Invalid date range');
  if (to - from > 366 * 86400000) throw bad('Date range cannot exceed one year');
  return { from, to };
}
const r1 = (n) => Math.round(n * 10) / 10;
// Combines data owned by the booking, payment and parking services (read through their internal endpoints).
async function buildOverview(from, to) {
  const qs = `?from=${from.toISOString()}&to=${to.toISOString()}`;
  const [bk, pay, locs] = await Promise.all([call(BOOKING, `/internal/analytics${qs}`), call(PAYMENT, `/internal/analytics${qs}`), call(PARKING, '/internal/locations-summary')]);
  const cap = (l) => Math.max(0, l.total - l.maintenance); const capacity = locs.reduce((a, l) => a + cap(l), 0);
  const rangeHours = Math.max(1, (to - from) / 3600000), days = Math.max(1, Math.ceil(rangeHours / 24));
  const nameOf = new Map(locs.map((l) => [l.id, l.name]));
  const revLoc = new Map(pay.byLocation.map((r) => [r._id, r])); const bkLoc = new Map(bk.byLocation.map((r) => [r.locationId, r]));
  const rows = locs.map((l) => { const b = bkLoc.get(l.id) || {}, r = revLoc.get(l.id) || {};
    return { locationId: l.id, location: l.name, totalSlots: l.total, bookings: b.bookings || 0, revenue: Math.round((r.revenue || 0) * 100) / 100,
      occupancyPct: cap(l) ? r1(((b.slotHours || 0) / (cap(l) * rangeHours)) * 100) : 0, avgStayMinutes: b.stayN ? Math.round(b.stayMin / b.stayN) : 0, currentOccupied: l.occupied + l.reserved }; });
  rows.sort((a, b) => b.bookings - a.bookings || b.revenue - a.revenue);
  const now = locs.reduce((a, l) => ({ total: a.total + l.total, available: a.available + l.available, occupied: a.occupied + l.occupied, reserved: a.reserved + l.reserved, maintenance: a.maintenance + l.maintenance }), { total: 0, available: 0, occupied: 0, reserved: 0, maintenance: 0 });
  const totalRevenue = pay.byLocation.reduce((a, r) => a + r.revenue, 0); const st = bk.status;
  return {
    range: { from, to },
    current: { ...now, occupancyPct: capacity ? r1(((now.occupied + now.reserved) / capacity) * 100) : 0 },
    occupancy: {
      byHour: bk.slotHoursByHour.map((v, hour) => ({ hour, pct: capacity ? r1((v / days / capacity) * 100) : 0 })),
      byDay: bk.slotHoursByDay.map((d) => ({ date: d.date, pct: capacity ? r1((d.slotHours / (capacity * 24)) * 100) : 0 })),
      mostOccupiedLocations: rows.slice().sort((a, b) => b.occupancyPct - a.occupancyPct).slice(0, 5).map((r) => ({ location: r.location, pct: r.occupancyPct })),
      mostOccupiedSlots: bk.topSlots.map((t) => ({ location: t.locationName, slot: t.slot, slotHours: t.slotHours })),
    },
    revenue: { total: Math.round(totalRevenue * 100) / 100, byLocation: pay.byLocation.map((r) => ({ location: nameOf.get(r._id) || 'Unknown', revenue: Math.round(r.revenue * 100) / 100, transactions: r.transactions })).sort((a, b) => b.revenue - a.revenue),
      byMethod: pay.byMethod.map((r) => ({ method: r._id || 'unknown', revenue: Math.round(r.revenue * 100) / 100, transactions: r.transactions })), paymentsByStatus: pay.byStatus },
    bookings: { total: bk.total, active: st.active, completed: st.completed, cancelled: st.cancelled, pending: st.reserved, expired: st.expired, cancellationRatePct: bk.total ? r1((st.cancelled / bk.total) * 100) : 0, conversionRatePct: null },
    performance: { avgStayMinutes: bk.avgStayMinutes, avgBookingValue: bk.avgBookingValue || pay.avgBookingValue, slotUtilizationPct: capacity ? r1(((bk.slotHoursByHour.reduce((a, b) => a + b, 0)) / (capacity * rangeHours)) * 100) : 0 },
    topLocations: rows.slice(0, 10),
  };
}
async function summary() {
  const [slots, today, week, month, bookings, cancelled, avg] = await Promise.all([
    call(PARKING, '/internal/stats').catch(() => null),
    Fact.aggregate([{ $match: { type: 'payment', at: { $gte: daysAgo(1) } } }, { $group: { _id: null, v: { $sum: '$amount' } } }]),
    Fact.aggregate([{ $match: { type: 'payment', at: { $gte: daysAgo(7) } } }, { $group: { _id: null, v: { $sum: '$amount' } } }]),
    Fact.aggregate([{ $match: { type: 'payment', at: { $gte: daysAgo(30) } } }, { $group: { _id: null, v: { $sum: '$amount' } } }]),
    Fact.countDocuments({ type: 'booking', at: { $gte: daysAgo(30) } }), Fact.countDocuments({ type: 'cancel', at: { $gte: daysAgo(30) } }),
    Fact.aggregate([{ $match: { type: 'exit', durationMinutes: { $gt: 0 } } }, { $group: { _id: null, v: { $avg: '$durationMinutes' } } }]),
  ]);
  const busy = slots ? slots.occupied + slots.reserved : 0;
  return { slots, utilizationPct: slots?.total ? Math.round((busy / slots.total) * 1000) / 10 : 0, revenue: { today: today[0]?.v || 0, week: week[0]?.v || 0, month: month[0]?.v || 0 },
    bookings30d: bookings, cancellations30d: cancelled, avgDurationMinutes: Math.round(avg[0]?.v || 0) };
}

(async () => {
  await connect('analytics-service');
  await bus.subscribe('analytics-service.events', ['booking.#', 'payment.recorded'], async (key, m) => {
    const base = { locationId: m.locationId, at: m._at ? new Date(m._at) : new Date() };
    if (key === 'booking.created') await Fact.create({ ...base, type: 'booking', vehicleType: m.vehicleType, amount: m.amount, at: new Date(m.start) });
    else if (key === 'booking.cancelled') await Fact.create({ ...base, type: 'cancel' });
    else if (key === 'booking.entry') await Fact.create({ ...base, type: 'entry' });
    else if (key === 'booking.exit') await Fact.create({ ...base, type: 'exit', vehicleType: m.vehicleType, durationMinutes: m.durationMinutes });
    else if (key === 'payment.recorded') await Fact.create({ ...base, type: 'payment', amount: m.amount });
  });
  const app = createApp({ name: 'analytics-service' });
  app.use(authenticate(), adminOnly);
  app.get('/summary', asyncH(async (_q, res) => ok(res, await summary())));
  app.get('/revenue', asyncH(async (req, res) => { const p = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'daily'; const hasRange = req.query.from || req.query.to; const r = hasRange ? parseRange(req.query) : {}; ok(res, await revenue(p, r.from, r.to)); }));
  app.get('/overview', asyncH(async (req, res) => { const { from, to } = parseRange(req.query); ok(res, await buildOverview(from, to)); }));
  app.get('/peak-hours', asyncH(async (_q, res) => {
    const r = await Fact.aggregate([{ $match: { type: { $in: ['booking', 'entry'] }, at: { $gte: daysAgo(30) } } }, { $group: { _id: { $hour: { date: '$at', timezone: `+0${TZ_OFFSET_H}:00` } }, n: { $sum: 1 } } }]);
    const m = new Map(r.map((x) => [x._id, x.n])); ok(res, Array.from({ length: 24 }, (_, h) => ({ hour: h, count: m.get(h) || 0 })));
  }));
  app.get('/vehicles', asyncH(async (_q, res) => ok(res, await Fact.aggregate([{ $match: { type: 'booking', at: { $gte: daysAgo(90) } } }, { $group: { _id: '$vehicleType', bookings: { $sum: 1 }, value: { $sum: '$amount' } } }, { $sort: { bookings: -1 } }]))));
  // Export respects the selected date range (?from=&to=) and period. CSV and PDF contain the same sections.
  app.get('/export', asyncH(async (req, res) => {
    const fmt = req.query.format; if (!['csv', 'pdf'].includes(fmt)) throw bad('format must be csv or pdf');
    const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'daily';
    const { from, to } = parseRange(req.query);
    const [rev, s, ov] = await Promise.all([revenue(period, from, to), summary(), buildOverview(from, to).catch(() => null)]);
    const tag = `${from.toISOString().slice(0, 10)}_to_${to.toISOString().slice(0, 10)}`;
    bus.audit(req, 'report.exported', { format: fmt, period, from, to }); res.setHeader('Cache-Control', 'no-store');
    if (fmt === 'csv') {
      const out = [`# Smart Parking report`, `# Range,${from.toISOString().slice(0, 10)},${to.toISOString().slice(0, 10)}`, '', `# Revenue (${period})`, 'period,revenue,transactions', ...rev.map((r) => [r.period, r.revenue, r.transactions].map(csvCell).join(','))];
      if (ov) {
        out.push('', '# Bookings', 'metric,value', ...Object.entries({ total: ov.bookings.total, active: ov.bookings.active, completed: ov.bookings.completed, cancelled: ov.bookings.cancelled, pending: ov.bookings.pending, cancellation_rate_pct: ov.bookings.cancellationRatePct, avg_stay_minutes: ov.performance.avgStayMinutes, avg_booking_value: ov.performance.avgBookingValue }).map(([k, v]) => [k, v].map(csvCell).join(',')),
          '', '# Top locations', 'location,bookings,revenue,occupancy_pct,avg_stay_minutes', ...ov.topLocations.map((l) => [l.location, l.bookings, l.revenue, l.occupancyPct, l.avgStayMinutes].map(csvCell).join(',')),
          '', '# Revenue by payment method', 'method,revenue,transactions', ...ov.revenue.byMethod.map((m) => [m.method, m.revenue, m.transactions].map(csvCell).join(',')));
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="report-${tag}.csv"`);
      return res.send(out.join('\n'));
    }
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="report-${tag}.pdf"`);
    const doc = new PDFDocument({ margin: 48 }); doc.pipe(res);
    doc.fontSize(20).text('Smart Parking Report'); doc.fontSize(10).fillColor('#555').text(`Range ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}   Generated ${new Date().toISOString()}`).moveDown();
    doc.fillColor('#000').fontSize(12).text(`Slots now: ${s.slots?.total ?? 'n/a'} total, ${s.slots?.available ?? 'n/a'} available, ${s.slots?.occupied ?? 'n/a'} occupied   Utilization: ${s.utilizationPct}%`).moveDown(0.5);
    if (ov) {
      doc.text(`Bookings: ${ov.bookings.total} total, ${ov.bookings.completed} completed, ${ov.bookings.active} active, ${ov.bookings.pending} pending, ${ov.bookings.cancelled} cancelled (${ov.bookings.cancellationRatePct}%)`);
      doc.text(`Revenue (paid): ${ov.revenue.total}   Avg stay: ${ov.performance.avgStayMinutes} min   Avg booking value: ${ov.performance.avgBookingValue}`).moveDown();
      doc.fontSize(13).text('Top locations').fontSize(11).moveDown(0.3);
      ov.topLocations.forEach((l) => doc.text(`${l.location}: ${l.bookings} bookings, revenue ${l.revenue}, occupancy ${l.occupancyPct}%, avg stay ${l.avgStayMinutes} min`));
      doc.moveDown().fontSize(13).text('Revenue by payment method').fontSize(11).moveDown(0.3);
      ov.revenue.byMethod.forEach((m) => doc.text(`${m.method}: ${m.revenue} (${m.transactions} transactions)`)); doc.moveDown();
    }
    doc.fontSize(13).text(`Revenue (${period})`).moveDown(0.5).fontSize(11);
    rev.forEach((r) => doc.text(`${r.period}    ${r.revenue}    (${r.transactions} transactions)`)); doc.end();
  }));
  finish(app); app.listen(4009, () => console.log('[analytics-service] listening on 4009'));
})().catch((e) => { console.error('[analytics-service] fatal:', e.message); process.exit(1); });
