'use strict';
// AES-256-GCM field encryption, HMAC blind index, and signed expiring tickets.
const crypto = require('node:crypto');
const { req } = require('./env');

const key = () => {
  const k = Buffer.from(req('ENCRYPTION_KEY'), 'base64');
  if (k.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  return k;
};
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}
function decrypt(blob) {
  const [v, iv, tag, ct] = String(blob).split(':');
  if (v !== 'v1') throw new Error('unsupported ciphertext');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
// Deterministic keyed hash for lookups/uniqueness without storing plaintext.
const blindIndex = (v) => crypto.createHmac('sha256', key()).update(String(v).toUpperCase()).digest('hex');

// Ticket format: <bookingId>.<expUnix>.<nonce>.<sig>
function signTicket({ bookingId, nonce, exp }, secret = req('QR_SIGNING_SECRET')) {
  const body = `${bookingId}.${exp}.${nonce}`;
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}
function verifyTicket(token, secret = req('QR_SIGNING_SECRET')) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4) throw new Error('invalid ticket');
  const [bookingId, exp, nonce, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${bookingId}.${exp}.${nonce}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error('invalid ticket');
  if (+exp <= Math.floor(Date.now() / 1000)) throw new Error('ticket expired');
  return { bookingId, nonce, exp: +exp };
}
const randomToken = (n = 32) => crypto.randomBytes(n).toString('base64url');
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
module.exports = { encrypt, decrypt, blindIndex, signTicket, verifyTicket, randomToken, sha256 };
