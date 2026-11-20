'use strict';
// Central environment access. Fails fast when a required secret is missing so
// the app never silently runs with an empty or default secret.
function req(name, { minLength = 1 } = {}) {
  const v = process.env[name];
  if (!v || v.length < minLength) {
    throw new Error(`Missing or too-short environment variable: ${name}`);
  }
  return v;
}
const opt = (name, fallback) => (process.env[name] !== undefined && process.env[name] !== '' ? process.env[name] : fallback);
const isProd = () => process.env.NODE_ENV === 'production';
module.exports = { req, opt, isProd };
