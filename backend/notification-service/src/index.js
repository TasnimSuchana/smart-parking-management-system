'use strict';
const http = require('node:http');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const { Server } = require('socket.io');
const { createApp, finish } = require('../../shared/app');
const { connect } = require('../../shared/db');
const { req: envReq, opt, isProd } = require('../../shared/env');
const { asyncH, authenticate, ok, page, ISS, AUD } = require('../../shared/middleware');
const { notFound } = require('../../shared/errors');
const jwt = require('../../shared/jwt');
const bus = require('../../shared/bus');

const Notification = mongoose.model('Notification', new mongoose.Schema({
  userId: { type: String, index: true }, title: String, message: String, type: { type: String, default: 'info' }, read: { type: Boolean, default: false },
}, { timestamps: true }).index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86400 }));

const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: +opt('SMTP_PORT', '587'), secure: opt('SMTP_SECURE', 'false') === 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined }) : null;
const PUBLIC_URL = opt('PUBLIC_URL', 'http://localhost:8080');

(async () => {
  await connect('notification-service'); await bus.connect();
  const app = createApp({ name: 'notification-service' });
  const server = http.createServer(app);
  const io = new Server(server, { path: '/socket.io', cors: { origin: opt('CORS_ORIGINS', PUBLIC_URL).split(','), credentials: true }, maxHttpBufferSize: 1e4 });

  // Handshake auth: a valid login is required; guests are rejected.
  io.use((socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie || ''; const m = /(?:^|;\s*)access_token=([^;]+)/.exec(raw);
      if (m) { const c = jwt.verify(decodeURIComponent(m[1]), envReq('JWT_ACCESS_SECRET', { minLength: 32 }), { iss: ISS, aud: AUD }); socket.data.user = { id: c.sub, role: c.role }; }
    } catch { /* invalid token */ }
    if (!socket.data.user) return next(new Error('unauthorized'));
    next();
  });
  io.on('connection', async (socket) => {
    const u = socket.data.user;
    if (u) { socket.join(`user:${u.id}`); if (u.role === 'admin') socket.join('admins'); }
    socket.on('subscribe:location', async (id, ack) => {
      if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) return ack?.({ ok: false });
      socket.join(`loc:${id}`);
      if (u?.role === 'admin') socket.join(`staff:${id}`);
      ack?.({ ok: true, staff: socket.rooms.has(`staff:${id}`) });
    });
  });

  const notify = async (userId, title, message, type) => { if (!userId) return; const n = await Notification.create({ userId, title, message, type }); io.to(`user:${userId}`).emit('notification', { id: n._id, title, message, type, createdAt: n.createdAt }); };
  await bus.subscribe('notification-service.events', ['slot.#', 'booking.#', 'camera.#', 'notify.#', 'alert.#', 'email.#', 'payment.#'], async (key, m) => {
    if (key === 'slot.updated') io.to(`loc:${m.locationId}`).emit('slot:updated', { slotId: m.slotId, label: m.label, status: m.status, locationId: m.locationId });
    else if (key === 'booking.created') await notify(m.userId, 'Booking confirmed', `Slot ${m.slotLabel} is reserved.`, 'success');
    else if (key === 'booking.cancelled') await notify(m.userId, 'Booking cancelled', `Your booking for slot ${m.slotLabel} was cancelled.`, 'info');
    else if (key === 'booking.entry') await notify(m.userId, 'Entry recorded', `Welcome! Slot ${m.slotLabel}.`, 'success');
    else if (key === 'booking.exit') await notify(m.userId, 'Exit recorded', `Parking ended. Amount: ${m.amount}.`, 'info');
    else if (key === 'booking.expired') await notify(m.userId, 'Booking expired', 'You did not check in before the booking ended.', 'warning');
    else if (key.startsWith('camera.')) io.to(`staff:${m.locationId}`).to('admins').emit(key.replace('camera.', 'camera:'), m);
    else if (key === 'notify.admin_alert') io.to('admins').emit('alert', m);
    else if (key === 'email.password_reset') {
      const link = `${PUBLIC_URL}/reset-password?token=${encodeURIComponent(m.token)}`;
      if (mailer) await mailer.sendMail({ from: opt('MAIL_FROM', 'no-reply@smartparking.local'), to: m.to, subject: 'Reset your password', text: `Hello ${m.name},\n\nUse this link within 30 minutes to reset your password:\n${link}\n\nIf you did not request this, ignore this email.` });
      else if (!isProd()) console.log(`[dev] SMTP not configured. Password reset link for ${m.to}: ${link}`);
      else console.error('[notification] SMTP not configured; password reset email not sent');
    }
  });

  app.use(authenticate());
  app.get('/', asyncH(async (req, res) => { const { page: pg, limit, skip } = page(req.query); const f = { userId: req.user.id };
    const [items, total, unread] = await Promise.all([Notification.find(f).sort('-createdAt').skip(skip).limit(limit), Notification.countDocuments(f), Notification.countDocuments({ ...f, read: false })]); ok(res, items, { page: pg, limit, total, unread }); }));
  app.patch('/read-all', asyncH(async (req, res) => { await Notification.updateMany({ userId: req.user.id, read: false }, { read: true }); ok(res, { done: true }); }));
  app.patch('/:id/read', asyncH(async (req, res) => { const n = await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.user.id }, { read: true }, { new: true }); if (!n) throw notFound(); ok(res, n); }));
  finish(app); server.listen(4008, () => console.log('[notification-service] listening on 4008'));
})().catch((e) => { console.error('[notification-service] fatal:', e.message); process.exit(1); });
