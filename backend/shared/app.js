'use strict';
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { sanitize, csrfGuard, errorHandler } = require('./middleware');
const { notFound } = require('./errors');

// Express app with the security baseline shared by every service.
function createApp({ name, csrf = true, jsonLimit = '100kb' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.get('/health', (_q, res) => res.json({ status: 'ok', service: name }));
  app.use(express.json({ limit: jsonLimit }));
  app.use(cookieParser());
  app.use(sanitize);
  if (csrf) app.use(csrfGuard);
  return app;
}
function finish(app) {
  app.use((_req, _res, next) => next(notFound('Route not found')));
  app.use(errorHandler);
}
module.exports = { createApp, finish };
