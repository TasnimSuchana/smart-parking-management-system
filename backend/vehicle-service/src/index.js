'use strict';
const { z } = require('zod');
const mongoose = require('mongoose');
const { createApp, finish } = require('../../shared/app');
const { connect } = require('../../shared/db');
const { asyncH, authenticate, validate, internalOnly, ok } = require('../../shared/middleware');
const { notFound, conflict } = require('../../shared/errors');
const { encrypt, decrypt, blindIndex } = require('../../shared/secure');
const bus = require('../../shared/bus');

const TYPES = ['car', 'bike', 'suv', 'truck', 'ev'];
// Plate numbers are personal data: encrypted at rest (AES-256-GCM); a keyed hash enforces per-owner uniqueness.
const Vehicle = mongoose.model('Vehicle', new mongoose.Schema({
  userId: { type: String, required: true, index: true }, plateEnc: { type: String, required: true }, plateIdx: { type: String, required: true },
  type: { type: String, enum: TYPES, required: true }, make: { type: String, maxlength: 40 }, model: { type: String, maxlength: 40 }, color: { type: String, maxlength: 30 },
}, { timestamps: true }).index({ userId: 1, plateIdx: 1 }, { unique: true }));
const view = (v) => ({ id: v._id, plate: decrypt(v.plateEnc), type: v.type, make: v.make, model: v.model, color: v.color });
const plate = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9 -]{3,14}[A-Z0-9]$/, 'Invalid registration number');
const body = z.object({ plate, type: z.enum(TYPES), make: z.string().trim().max(40).optional(), model: z.string().trim().max(40).optional(), color: z.string().trim().max(30).optional() }).strict();

(async () => {
  await connect('vehicle-service'); bus.connect().catch(() => {});
  const app = createApp({ name: 'vehicle-service' });
  app.use((q, r, n) => (q.path.startsWith('/internal') ? n() : authenticate()(q, r, n)));

  app.get('/', asyncH(async (req, res) => ok(res, (await Vehicle.find({ userId: req.user.id }).sort('-createdAt')).map(view))));
  app.post('/', validate(body), asyncH(async (req, res) => {
    if ((await Vehicle.countDocuments({ userId: req.user.id })) >= 10) throw conflict('Vehicle limit (10) reached');
    const { plate: p, ...rest } = req.body;
    const v = await Vehicle.create({ ...rest, userId: req.user.id, plateEnc: encrypt(p), plateIdx: blindIndex(p) }).catch((e) => { if (e.code === 11000) throw conflict('This vehicle is already registered'); throw e; });
    ok(res, view(v), null, 201);
  }));
  // Ownership enforced in the query itself (IDOR protection).
  app.put('/:id', validate(body.partial()), asyncH(async (req, res) => {
    const v = await Vehicle.findOne({ _id: req.params.id, userId: req.user.id }); if (!v) throw notFound('Vehicle not found');
    const { plate: p, ...rest } = req.body; Object.assign(v, rest); if (p) { v.plateEnc = encrypt(p); v.plateIdx = blindIndex(p); }
    await v.save().catch((e) => { if (e.code === 11000) throw conflict('This vehicle is already registered'); throw e; }); ok(res, view(v));
  }));
  app.delete('/:id', asyncH(async (req, res) => { const v = await Vehicle.findOneAndDelete({ _id: req.params.id, userId: req.user.id }); if (!v) throw notFound('Vehicle not found'); ok(res, { deleted: true }); }));

  app.get('/internal/:id', internalOnly, asyncH(async (req, res) => {
    const v = await Vehicle.findById(req.params.id); if (!v) throw notFound();
    const p = decrypt(v.plateEnc); ok(res, { id: v._id, userId: v.userId, type: v.type, plate: p, plateMasked: `${p.slice(0, 2)}***${p.slice(-2)}` });
  }));
  finish(app); app.listen(4005, () => console.log('[vehicle-service] listening on 4005'));
})().catch((e) => { console.error('[vehicle-service] fatal:', e.message); process.exit(1); });
