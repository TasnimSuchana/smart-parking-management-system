'use strict';
const mongoose = require('mongoose');
const { req, opt } = require('./env');

// Each service connects with its own least-privilege user to its own database.
async function connect(service) {
  const base = service.replace(/-service$/, '').replace(/-/g, '_');
  const user = encodeURIComponent(`${base}_user`);
  const pw = encodeURIComponent(req('MONGO_APP_PASSWORD', { minLength: 16 }));
  const host = opt('MONGO_HOST', 'mongo:27017');
  const uri = `mongodb://${user}:${pw}@${host}/${base}_db?authSource=${base}_db`;
  mongoose.set('strictQuery', true);
  for (let i = 1; ; i++) {
    try { await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, autoIndex: true }); break; }
    catch (e) { console.error(`[${service}] MongoDB unavailable (attempt ${i}): ${e.message.split('\n')[0]}`); await new Promise((r) => setTimeout(r, Math.min(i * 1000, 10000))); }
  }
  mongoose.connection.on('disconnected', () => console.error(`[${service}] MongoDB disconnected`));
  return mongoose;
}
module.exports = { connect };
