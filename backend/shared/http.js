'use strict';
// Service-to-service calls (internal network only) authenticated with a shared key.
const { req: envReq } = require('./env');
const { AppError } = require('./errors');
async function call(base, path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json', 'x-internal-key': envReq('INTERNAL_API_KEY', { minLength: 32 }) },
      body: body ? JSON.stringify(body) : undefined });
  } catch { throw new AppError(503, 'A dependent service is unavailable', 'UPSTREAM_UNAVAILABLE'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new AppError(res.status === 404 ? 404 : res.status >= 500 ? 502 : res.status, json?.error?.message || 'Upstream error', json?.error?.code || 'UPSTREAM');
  return json.data;
}
const url = (name, port) => process.env[`${name.toUpperCase()}_URL`] || `http://${name}-service:${port}`;
module.exports = { call, url, PORTS: { auth: 4001, user: 4002, parking: 4003, booking: 4004, vehicle: 4005, payment: 4006, camera: 4007, notification: 4008, analytics: 4009, audit: 4010 } };
