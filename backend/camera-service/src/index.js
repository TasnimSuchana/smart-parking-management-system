'use strict';
const express = require('express');
const { z } = require('zod');
const mongoose = require('mongoose');
const { createApp, finish } = require('../../shared/app');
const { connect } = require('../../shared/db');
const { req: envReq, opt } = require('../../shared/env');
const { asyncH, authenticate, adminOnly, validate, ok } = require('../../shared/middleware');
const { notFound, bad, AppError } = require('../../shared/errors');
const bus = require('../../shared/bus');
const { encrypt, decrypt } = require('../../shared/secure');
const { call, url, PORTS } = require('../../shared/http');

const PARKING = url('parking', PORTS.parking);
const rect = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.01).max(1), h: z.number().min(0.01).max(1) });
// Zone = calibrated mapping of normalised image rectangles to parking slots for ONE fixed camera position.
const Zone = mongoose.model('CameraZone', new mongoose.Schema({
  locationId: { type: String, required: true, index: true }, name: { type: String, required: true, maxlength: 80 },
  slots: [{ slotId: String, label: String, rect: { x: Number, y: Number, w: Number, h: Number } }],
  minConfidence: { type: Number, default: 0.5 }, minOverlap: { type: Number, default: 0.35 }, framesRequired: { type: Number, default: 3 },
  calibratedAt: Date, calibratedBy: String,
}, { timestamps: true }));
const Session = mongoose.model('MonitoringSession', new mongoose.Schema({
  userId: String, locationId: String, zoneId: String, status: { type: String, enum: ['active', 'stopped', 'disconnected'], default: 'active' },
  lastHeartbeat: { type: Date, default: Date.now }, framesProcessed: { type: Number, default: 0 },
}, { timestamps: true }));

// Detection history shown on the monitoring page (kept 30 days). Plates, if the detector reads them, are stored encrypted.
const DetectionEvent = mongoose.model('DetectionEvent', new mongoose.Schema({
  zoneId: { type: String, index: true }, locationId: String, slotId: String, slotLabel: String,
  type: { type: String, enum: ['vehicle_detected', 'vehicle_confirmed', 'slot_occupied', 'vehicle_left', 'slot_available', 'manual_override'] },
  message: String, confidence: Number, plateEnc: String, at: { type: Date, default: Date.now, index: true },
}).index({ at: 1 }, { expireAfterSeconds: 30 * 86400 }));
const safeDecrypt = (v) => { try { return decrypt(v); } catch { return null; } };
const evView = (e) => ({ id: String(e._id), type: e.type, message: e.message, slotId: e.slotId, slot: e.slotLabel, confidence: e.confidence ?? null, plate: e.plateEnc ? safeDecrypt(e.plateEnc) : null, at: e.at });
// Only accept plate text that looks like a registration number (the detector is an external service).
const cleanPlate = (p) => (typeof p === 'string' && /^[A-Z0-9][A-Z0-9 -]{3,14}[A-Z0-9]$/.test(p.trim().toUpperCase()) ? p.trim().toUpperCase() : undefined);
async function logEvent(zone, sl, type, message, { confidence, plate } = {}) {
  const e = await DetectionEvent.create({ zoneId: String(zone._id), locationId: zone.locationId, slotId: sl.slotId, slotLabel: sl.label, type, message, confidence, plateEnc: plate ? encrypt(plate) : undefined });
  bus.publish('camera.event', { zoneId: String(zone._id), locationId: zone.locationId, slotId: sl.slotId, label: sl.label, type, message, confidence, at: e.at });
  return { ...evView(e), plate: plate || null };
}

const VEHICLE_LABELS = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle']);
const overlap = (a, b) => { // fraction of slot rect covered by detection box
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (w * h) / (b.w * b.h);
};
const streaks = new Map(); // `${zoneId}:${slotId}` -> {state, n}; per-instance debounce so one noisy frame never flips a slot
const isJpeg = (b) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

// Detector adapter: POST image/jpeg to an inference server (e.g. Ultralytics YOLO) that returns
// { detections: [{ label, confidence, box: {x,y,w,h} /* normalised 0-1 */ }] }.
async function detect(buf) {
  const base = opt('DETECTOR_URL', '');
  if (!base) throw new AppError(503, 'Vehicle detector is not configured (set DETECTOR_URL). Use manual correction meanwhile.', 'DETECTOR_UNAVAILABLE');
  let r; try { r = await fetch(`${base}/detect`, { method: 'POST', headers: { 'content-type': 'image/jpeg', 'x-api-key': opt('DETECTOR_API_KEY', '') }, body: buf, signal: AbortSignal.timeout(8000) }); }
  catch { throw new AppError(503, 'Vehicle detector unreachable', 'DETECTOR_UNAVAILABLE'); }
  if (!r.ok) throw new AppError(502, 'Detector error', 'DETECTOR_ERROR');
  return (await r.json()).detections || [];
}

(async () => {
  envReq('INTERNAL_API_KEY', { minLength: 32 });
  await connect('camera-service'); bus.connect().catch(() => {});
  const app = createApp({ name: 'camera-service' });
  app.use(authenticate(), adminOnly); // every camera endpoint is admin-only; nothing is public

  app.get('/zones', asyncH(async (req, res) => {
    const f = {};
    if (typeof req.query.locationId === 'string') f.locationId = req.query.locationId; ok(res, await Zone.find(f));
  }));
  app.post('/zones', adminOnly, validate(z.object({ locationId: z.string().min(10).max(40), name: z.string().trim().min(2).max(80), minConfidence: z.number().min(0.1).max(0.99).optional(), minOverlap: z.number().min(0.1).max(0.9).optional(), framesRequired: z.number().int().min(1).max(10).optional() }).strict()), asyncH(async (req, res) => { const z1 = await Zone.create(req.body); bus.audit(req, 'camera.zone_created', { id: String(z1._id) }); ok(res, z1, null, 201); }));
  app.put('/zones/:id/calibration', adminOnly, validate(z.object({ slots: z.array(z.object({ slotId: z.string().min(10).max(40), label: z.string().max(20), rect })).max(100) }).strict()), asyncH(async (req, res) => {
    const z1 = await Zone.findByIdAndUpdate(req.params.id, { slots: req.body.slots, calibratedAt: new Date(), calibratedBy: req.user.id }, { new: true }); if (!z1) throw notFound(); bus.audit(req, 'camera.calibrated', { id: req.params.id }); ok(res, z1);
  }));
  app.delete('/zones/:id', adminOnly, asyncH(async (req, res) => { const z1 = await Zone.findByIdAndDelete(req.params.id); if (!z1) throw notFound(); bus.audit(req, 'camera.zone_deleted', { id: req.params.id }, 'warn'); ok(res, { deleted: true }); }));

  app.post('/sessions', validate(z.object({ zoneId: z.string().min(10).max(40) }).strict()), asyncH(async (req, res) => {
    const zone = await Zone.findById(req.body.zoneId); if (!zone) throw notFound('Zone not found');
    if (!zone.calibratedAt) throw bad('This zone has not been calibrated by an administrator yet');
    const s = await Session.create({ userId: req.user.id, locationId: zone.locationId, zoneId: String(zone._id) });
    bus.audit(req, 'camera.session_started', { zoneId: String(zone._id) }); bus.publish('camera.session', { sessionId: String(s._id), locationId: s.locationId, zoneId: s.zoneId, status: 'active', userId: s.userId }); ok(res, s, null, 201);
  }));
  app.post('/sessions/:id/heartbeat', asyncH(async (req, res) => { const s = await Session.findOneAndUpdate({ _id: req.params.id, userId: req.user.id, status: { $ne: 'stopped' } }, { status: 'active', lastHeartbeat: new Date() }, { new: true }); if (!s) throw notFound(); ok(res, s); }));
  app.delete('/sessions/:id', asyncH(async (req, res) => { const s = await Session.findOneAndUpdate({ _id: req.params.id }, { status: 'stopped' }, { new: true }); if (!s) throw notFound();
    bus.publish('camera.session', { sessionId: String(s._id), locationId: s.locationId, zoneId: s.zoneId, status: 'stopped' }); ok(res, s); }));
  app.get('/monitoring/status', asyncH(async (req, res) => {
    const f = { status: { $ne: 'stopped' } };
    ok(res, await Session.find(f).sort('-lastHeartbeat').limit(100));
  }));

  // Frame upload: raw image/jpeg (max 2MB). Frames are analysed in memory and never stored.
  app.post('/zones/:id/detect', express.raw({ type: 'image/jpeg', limit: '2mb' }), asyncH(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !isJpeg(req.body)) throw bad('Send a JPEG image (Content-Type: image/jpeg)');
    const zone = await Zone.findById(req.params.id); if (!zone) throw notFound();
    const dets = (await detect(req.body)).filter((d) => VEHICLE_LABELS.has(d.label) && d.confidence >= zone.minConfidence && d.box);
    const result = [], events = [];
    const note = async (sl, type, message, extra) => events.push(await logEvent(zone, sl, type, message, extra));
    for (const sl of zone.slots) {
      // The most confident vehicle overlapping this slot's calibrated rectangle.
      const best = dets.filter((d) => overlap(d.box, sl.rect) >= zone.minOverlap).sort((a, b) => b.confidence - a.confidence)[0];
      const occupied = !!best, plate = cleanPlate(best?.plate), conf = best ? best.confidence : null;
      const k = `${zone._id}:${sl.slotId}`, st = streaks.get(k) || { state: occupied, n: 0, seen: false };
      st.n = st.state === occupied ? st.n + 1 : 1; st.state = occupied; if (occupied) st.seen = true; streaks.set(k, st);
      if (occupied && st.n === 1) await note(sl, 'vehicle_detected', `Vehicle detected at slot ${sl.label}`, { confidence: conf, plate });
      let applied = false;
      if (st.n === zone.framesRequired) { // validated: N consecutive consistent frames
        if (occupied) await note(sl, 'vehicle_confirmed', `Vehicle confirmed in slot ${sl.label}`, { confidence: conf, plate });
        else if (st.seen) { st.seen = false; await note(sl, 'vehicle_left', `Vehicle left slot ${sl.label}`); }
        const target = occupied ? 'occupied' : 'available';
        const cur = await call(PARKING, `/internal/slots/${sl.slotId}`).catch(() => null);
        if (cur && cur.status !== target && cur.status !== 'maintenance' && !(target === 'available' && cur.status === 'reserved')) {
          await call(PARKING, `/internal/slots/${sl.slotId}/status`, { method: 'PATCH', body: { status: target } }); applied = true;
          bus.publish('camera.detection', { zoneId: String(zone._id), locationId: zone.locationId, slotId: sl.slotId, label: sl.label, status: target });
          await note(sl, occupied ? 'slot_occupied' : 'slot_available', `Slot ${sl.label} ${occupied ? 'occupied' : 'available'}`, { confidence: conf, plate });
        }
      }
      result.push({ slotId: sl.slotId, label: sl.label, detectedOccupied: occupied, consecutiveFrames: st.n, applied, confidence: conf, plate: plate || null, box: best?.box || null });
    }
    await Session.updateMany({ zoneId: String(zone._id), userId: req.user.id, status: { $ne: 'stopped' } }, { $inc: { framesProcessed: 1 }, lastHeartbeat: new Date(), status: 'active' });
    ok(res, { vehicles: dets.length, framesRequired: zone.framesRequired, analysedAt: new Date(), detections: dets.map((d) => ({ label: d.label, confidence: d.confidence, box: d.box, plate: cleanPlate(d.plate) || null })), slots: result, events });
  }));

  // Recent detection history for a zone (newest first).
  app.get('/zones/:id/history', asyncH(async (req, res) => {
    const limit = Math.min(100, Math.max(1, +req.query.limit || 30));
    ok(res, (await DetectionEvent.find({ zoneId: req.params.id }).sort('-at').limit(limit)).map(evView));
  }));

  // Manual correction by an admin (audited).
  app.patch('/zones/:id/slots/:slotId', validate(z.object({ status: z.enum(['available', 'occupied', 'reserved', 'maintenance']) }).strict()), asyncH(async (req, res) => {
    const zone = await Zone.findById(req.params.id); if (!zone || !zone.slots.some((s) => s.slotId === req.params.slotId)) throw notFound();
    const r = await call(PARKING, `/internal/slots/${encodeURIComponent(req.params.slotId)}/status`, { method: 'PATCH', body: { status: req.body.status } });
    const sl = zone.slots.find((x) => x.slotId === req.params.slotId); await logEvent(zone, sl, 'manual_override', `Slot ${sl.label} set to ${req.body.status} manually`).catch(() => {});
    streaks.delete(`${zone._id}:${req.params.slotId}`); bus.audit(req, 'camera.manual_override', { slotId: req.params.slotId, status: req.body.status }, 'warn'); ok(res, r);
  }));

  finish(app);
  setInterval(async () => { // mark sessions with no heartbeat for 45s as disconnected
    try { for (const s of await Session.find({ status: 'active', lastHeartbeat: { $lt: new Date(Date.now() - 45000) } }).limit(100)) { s.status = 'disconnected'; await s.save(); bus.publish('camera.session', { sessionId: String(s._id), locationId: s.locationId, zoneId: s.zoneId, status: 'disconnected' }); } }
    catch (e) { console.error('[camera] sweeper', e.message); }
  }, 15000).unref();
  app.listen(4007, () => console.log('[camera-service] listening on 4007'));
})().catch((e) => { console.error('[camera-service] fatal:', e.message); process.exit(1); });
