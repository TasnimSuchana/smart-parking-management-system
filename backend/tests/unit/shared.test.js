'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const Module = require('node:module');

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.QR_SIGNING_SECRET = crypto.randomBytes(32).toString('hex');
process.env.JWT_ACCESS_SECRET = crypto.randomBytes(32).toString('hex');
process.env.INTERNAL_API_KEY = crypto.randomBytes(32).toString('hex');

// Allow running without installed deps: stub 'zod' only if it is unavailable.
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'zod') { try { return origLoad.call(this, request, ...rest); } catch { return { ZodError: class ZodError extends Error {} }; } }
  return origLoad.call(this, request, ...rest);
};
const S = (f) => require(path.join(__dirname, '../../shared', f));
const jwt = S('jwt.js'), pw = S('password.js'), sec = S('secure.js'), pricing = S('pricing.js'), mw = S('middleware.js');
const opts = { iss: 'i', aud: 'a' };

test('jwt: valid token verifies', () => {
  const t = jwt.sign({ sub: '1' }, 'secret', { expiresIn: 60, ...opts });
  assert.equal(jwt.verify(t, 'secret', opts).sub, '1');
});
test('jwt: expired token rejected', () => {
  const t = jwt.sign({ sub: '1' }, 'secret', { expiresIn: -5, ...opts });
  assert.throws(() => jwt.verify(t, 'secret', opts), /expired/);
});
test('jwt: wrong secret, issuer, audience rejected', () => {
  const t = jwt.sign({ sub: '1' }, 'secret', { expiresIn: 60, ...opts });
  assert.throws(() => jwt.verify(t, 'other', opts), /signature/);
  assert.throws(() => jwt.verify(t, 'secret', { iss: 'x', aud: 'a' }), /issuer/);
  assert.throws(() => jwt.verify(t, 'secret', { iss: 'i', aud: 'x' }), /audience/);
});
test('jwt: alg=none and tampered payload rejected', () => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const none = `${b({ alg: 'none' })}.${b({ sub: '1', role: 'admin', exp: 9999999999, ...{ iss: 'i', aud: 'a' } })}.`;
  assert.throws(() => jwt.verify(none, 'secret', opts));
  const t = jwt.sign({ sub: '1', role: 'user' }, 'secret', { expiresIn: 60, ...opts }).split('.');
  t[1] = b({ sub: '1', role: 'admin', exp: 9999999999, iss: 'i', aud: 'a' });
  assert.throws(() => jwt.verify(t.join('.'), 'secret', opts), /signature/);
});
test('password: hash/verify and policy', async () => {
  const h = await pw.hash('Str0ngPassw0rd');
  assert.ok(h.startsWith('scrypt$'));
  assert.equal(await pw.verify('Str0ngPassw0rd', h), true);
  assert.equal(await pw.verify('wrong', h), false);
  assert.ok(pw.policyError('short'));
  assert.ok(pw.policyError('alllowercase1234'));
  assert.equal(pw.policyError('GoodPassw0rd!'), null);
});
test('secure: AES-GCM roundtrip and tamper detection', () => {
  const c = sec.encrypt('DHAKA-METRO-11-2233');
  assert.equal(sec.decrypt(c), 'DHAKA-METRO-11-2233');
  const parts = c.split(':'); parts[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => sec.decrypt(parts.join(':')));
  assert.equal(sec.blindIndex('ab-12'), sec.blindIndex('AB-12'));
});
test('secure: signed ticket verify, expiry, tamper', () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const t = sec.signTicket({ bookingId: 'b1', nonce: 'n1', exp });
  assert.deepEqual(sec.verifyTicket(t), { bookingId: 'b1', nonce: 'n1', exp });
  assert.throws(() => sec.verifyTicket(t.replace('b1', 'b2')), /invalid/);
  const old = sec.signTicket({ bookingId: 'b1', nonce: 'n1', exp: Math.floor(Date.now() / 1000) - 1 });
  assert.throws(() => sec.verifyTicket(old), /expired/);
});
test('pricing: base, vehicle multiplier, peak, cap, demand', () => {
  const rule = { ...pricing.DEFAULT_RULE, peak: [], demand: [] };
  const s = '2026-01-01T00:00:00Z';
  assert.equal(pricing.calculate({ rule, start: s, end: '2026-01-01T02:00:00Z' }).total, 100);
  assert.equal(pricing.calculate({ rule, vehicleType: 'bike', start: s, end: '2026-01-01T02:00:00Z' }).total, 50);
  assert.equal(pricing.calculate({ rule, start: s, end: '2026-01-01T01:01:00Z' }).hours, 2);
  assert.equal(pricing.calculate({ rule, start: s, end: '2026-01-01T12:00:00Z' }).total, 400); // daily cap
  const peak = { ...rule, peak: [{ startHour: 6, endHour: 7, multiplier: 2 }] }; // 00:00Z == 06:00 local (UTC+6)
  assert.equal(pricing.calculate({ rule: peak, start: s, end: '2026-01-01T01:00:00Z' }).total, 100);
  const dem = { ...rule, demand: [{ minOccupancy: 90, multiplier: 1.5 }] };
  assert.equal(pricing.calculate({ rule: dem, start: s, end: '2026-01-01T01:00:00Z', occupancyPct: 95 }).total, 75);
  assert.throws(() => pricing.calculate({ rule, start: s, end: s }));
});
function run(mwFn, req) { return new Promise((resolve) => { const res = {}; mwFn(req, res, (e) => resolve(e || null)); }); }
test('sanitize strips $-operators and dotted keys', async () => {
  const req = { body: { email: { $ne: null }, a: { 'b.c': 1, ok: 2 }, list: [{ $gt: 1, x: 1 }] }, query: { q: { $regex: '.*' } }, params: {} };
  await run(mw.sanitize, req);
  assert.deepEqual(req.body, { email: {}, a: { ok: 2 }, list: [{ x: 1 }] });
  assert.deepEqual(req.query, { q: {} });
});
test('csrfGuard: blocks cookie-auth POST without matching header', async () => {
  const base = { method: 'POST', cookies: { access_token: 'x', csrf: 'abc123' }, headers: {} };
  assert.equal((await run(mw.csrfGuard, base)).status, 403);
  assert.equal((await run(mw.csrfGuard, { ...base, headers: { 'x-csrf-token': 'wrong1' } })).status, 403);
  assert.equal(await run(mw.csrfGuard, { ...base, headers: { 'x-csrf-token': 'abc123' } }), null);
  assert.equal(await run(mw.csrfGuard, { ...base, method: 'GET' }), null);
});
test('requireRole: enforces roles server-side', async () => {
  assert.equal((await run(mw.adminOnly, { user: { role: 'user' } })).status, 403);
  assert.equal((await run(mw.adminOnly, { user: { role: 'registrar' } })).status, 403); // legacy role gets no access
  assert.equal((await run(mw.adminOnly, {})).status, 401);
  assert.equal(await run(mw.adminOnly, { user: { role: 'admin' } }), null);
  assert.equal(mw.staff, undefined); // the old staff helper no longer exists
});
test('internalOnly: rejects missing/incorrect key', async () => {
  assert.equal((await run(mw.internalOnly, { headers: {} })).status, 403);
  assert.equal((await run(mw.internalOnly, { headers: { 'x-internal-key': 'x'.repeat(64) } })).status, 403);
  assert.equal(await run(mw.internalOnly, { headers: { 'x-internal-key': process.env.INTERNAL_API_KEY } }), null);
});
