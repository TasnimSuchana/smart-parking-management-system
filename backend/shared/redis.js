'use strict';
const Redis = require('ioredis');
const { opt } = require('./env');
let client;
function get() {
  if (!client) {
    client = new Redis(opt('REDIS_URL', 'redis://redis:6379'), { password: process.env.REDIS_PASSWORD || undefined, maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: false });
    client.on('error', (e) => console.error('[redis]', e.message));
  }
  return client;
}
module.exports = { get };
