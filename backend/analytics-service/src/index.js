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
const PARKING = url('parking', PORTS.parking);
const TZ_OFFSET_H = +(process.env.ANALYTICS_UTC_OFFSET_HOURS || 6);
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; // blocks CSV formula injection

async function revenue(period) {
  const fmt = period === 'monthly' ? '%Y-%m' : period === 'weekly' ? '%G-W%V' : '%Y-%m-%d';
  const since = daysAgo(period === 'monthly' ? 365 : period === 'weekly' ? 120 : 30);
  return Fact.aggregate([{ $match: { type: 'payment', at: { $gte: since } } }, { $group: { _id: { $dateToString: { format: fmt, date: '$at', timezone: `+0${TZ_OFFSET_H}:00` } }, revenue: { $sum: '$amount' }, transactions: { $sum: 1 } } }, { $sort: { _id: 1 } }])
    .then((r) => r.map((x) => ({ period: x._id, revenue: Math.round(x.revenue * 100) / 100, transactions: x.transactions })));
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
  app.get('/revenue', asyncH(async (req, res) => { const p = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'daily'; ok(res, await revenue(p)); }));
  app.get('/peak-hours', asyncH(async (_q, res) => {
    const r = await Fact.aggregate([{ $match: { type: { $in: ['booking', 'entry'] }, at: { $gte: daysAgo(30) } } }, { $group: { _id: { $hour: { date: '$at', timezone: `+0${TZ_OFFSET_H}:00` } }, n: { $sum: 1 } } }]);
    const m = new Map(r.map((x) => [x._id, x.n])); ok(res, Array.from({ length: 24 }, (_, h) => ({ hour: h, count: m.get(h) || 0 })));
  }));
  app.get('/vehicles', asyncH(async (_q, res) => ok(res, await Fact.aggregate([{ $match: { type: 'booking', at: { $gte: daysAgo(90) } } }, { $group: { _id: '$vehicleType', bookings: { $sum: 1 }, value: { $sum: '$amount' } } }, { $sort: { bookings: -1 } }]))));
  app.get('/export', asyncH(async (req, res) => {
    const fmt = req.query.format; if (!['csv', 'pdf'].includes(fmt)) throw bad('format must be csv or pdf');
    const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'daily'; const [rev, s] = await Promise.all([revenue(period), summary()]);
    bus.audit(req, 'report.exported', { format: fmt, period }); res.setHeader('Cache-Control', 'no-store');
    if (fmt === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="revenue-${period}.csv"`);
      return res.send(['period,revenue,transactions', ...rev.map((r) => [r.period, r.revenue, r.transactions].map(csvCell).join(','))].join('\n'));
    }
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="report-${period}.pdf"`);
    const doc = new PDFDocument({ margin: 48 }); doc.pipe(res);
    doc.fontSize(20).text('Smart Parking Report'); doc.fontSize(10).fillColor('#555').text(`Generated ${new Date().toISOString()}`).moveDown();
    doc.fillColor('#000').fontSize(12).text(`Slots: ${s.slots?.total ?? 'n/a'} total, ${s.slots?.available ?? 'n/a'} available, ${s.slots?.occupied ?? 'n/a'} occupied`);
    doc.text(`Utilization: ${s.utilizationPct}%   Bookings (30d): ${s.bookings30d}   Avg duration: ${s.avgDurationMinutes} min`);
    doc.text(`Revenue  today: ${s.revenue.today}  7d: ${s.revenue.week}  30d: ${s.revenue.month}`).moveDown();
    doc.fontSize(13).text(`Revenue (${period})`).moveDown(0.5).fontSize(11);
    rev.forEach((r) => doc.text(`${r.period}    ${r.revenue}    (${r.transactions} transactions)`)); doc.end();
  }));
  finish(app); app.listen(4009, () => console.log('[analytics-service] listening on 4009'));
})().catch((e) => { console.error('[analytics-service] fatal:', e.message); process.exit(1); });
