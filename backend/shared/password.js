'use strict';
// scrypt (N=2^15, r=8, p=1, 16-byte salt, 64-byte key) via node:crypto.
// Stored as scrypt$N$r$p$salt$hash so parameters can be raised later.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const N = 2 ** 15, r = 8, p = 1, KEYLEN = 64;
const maxmem = 128 * N * r * 2;

async function hash(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r, p, maxmem });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verify(password, stored) {
  try {
    const [alg, n, rr, pp, salt, key] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(key, 'base64');
    const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length,
      { N: +n, r: +rr, p: +pp, maxmem: 128 * +n * +rr * 2 });
    return crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}
// Policy: 10-128 chars, upper, lower, digit.
function policyError(pw) {
  if (typeof pw !== 'string' || pw.length < 10 || pw.length > 128) return 'Password must be 10-128 characters';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Password needs upper-case, lower-case and a number';
  return null;
}
module.exports = { hash, verify, policyError };
