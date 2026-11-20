'use strict';
// Minimal HS256 JWT implementation on node:crypto. Verifies algorithm, signature
// (constant time), expiry, issuer and audience. "alg: none" is always rejected.
const crypto = require('node:crypto');
const enc = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

function sign(payload, secret, { expiresIn, iss, aud }) {
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc({ ...payload, iss, aud, iat: now, exp: now + expiresIn });
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function verify(token, secret, { iss, aud }) {
  if (typeof token !== 'string') throw new Error('invalid token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid token');
  const [h, p, s] = parts;
  let header, body;
  try { header = JSON.parse(Buffer.from(h, 'base64url')); body = JSON.parse(Buffer.from(p, 'base64url')); }
  catch { throw new Error('invalid token'); }
  if (header.alg !== 'HS256') throw new Error('invalid algorithm');
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error('invalid signature');
  if (typeof body.exp !== 'number' || body.exp <= Math.floor(Date.now() / 1000)) throw new Error('token expired');
  if (body.iss !== iss) throw new Error('invalid issuer');
  if (body.aud !== aud) throw new Error('invalid audience');
  return body;
}
module.exports = { sign, verify };
