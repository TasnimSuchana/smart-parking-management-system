'use strict';
// RabbitMQ topic exchange wrapper. Publishing never throws into request handlers.
const amqp = require('amqplib');
const { opt } = require('./env');
const EXCHANGE = 'parking.events';
let ch, connecting;
const pending = [];

async function connect() {
  if (ch) return ch;
  if (connecting) return connecting;
  connecting = (async () => {
    for (let i = 1; ; i++) {
      try {
        const conn = await amqp.connect(opt('RABBITMQ_URL', 'amqp://rabbitmq:5672'));
        conn.on('close', () => { ch = null; connecting = null; setTimeout(() => connect().catch(() => {}), 3000); });
        conn.on('error', (e) => console.error('[bus]', e.message));
        const c = await conn.createChannel();
        await c.assertExchange(EXCHANGE, 'topic', { durable: true });
        ch = c; connecting = null;
        while (pending.length) { const [k, m] = pending.shift(); publish(k, m); }
        return c;
      } catch (e) { console.error(`[bus] RabbitMQ unavailable (attempt ${i}): ${e.message}`); await new Promise((r) => setTimeout(r, Math.min(i * 1000, 10000))); }
    }
  })();
  return connecting;
}
function publish(key, payload) {
  const msg = { ...payload, _at: new Date().toISOString() };
  if (!ch) { if (pending.length < 1000) pending.push([key, msg]); connect().catch(() => {}); return; }
  try { ch.publish(EXCHANGE, key, Buffer.from(JSON.stringify(msg)), { persistent: true, contentType: 'application/json' }); }
  catch (e) { console.error('[bus] publish failed', e.message); }
}
async function subscribe(queue, patterns, handler) {
  const c = await connect();
  await c.assertQueue(queue, { durable: true });
  for (const p of patterns) await c.bindQueue(queue, EXCHANGE, p);
  c.prefetch(10);
  c.consume(queue, async (m) => {
    if (!m) return;
    try { await handler(m.fields.routingKey, JSON.parse(m.content.toString())); c.ack(m); }
    catch (e) { console.error(`[bus] handler failed for ${m.fields.routingKey}:`, e.message); c.nack(m, false, false); }
  });
}
// Convenience: audit trail event emitted from any service.
const audit = (req, action, meta = {}, severity = 'info') => publish(`audit.${action}`, {
  actorId: req.user?.id || null, actorRole: req.user?.role || 'guest', ip: req.ip, action, severity, meta });
const auditAs = (req, user, action, meta = {}, severity = 'info') => audit({ ip: req.ip, user }, action, meta, severity);
module.exports = { connect, publish, subscribe, audit, auditAs };
