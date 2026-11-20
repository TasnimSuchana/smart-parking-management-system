'use strict';
class AppError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; this.expose = true; }
}
const bad = (m) => new AppError(400, m, 'BAD_REQUEST');
const unauthorized = (m = 'Authentication required') => new AppError(401, m, 'UNAUTHORIZED');
const forbidden = (m = 'You do not have permission to do this') => new AppError(403, m, 'FORBIDDEN');
const notFound = (m = 'Not found') => new AppError(404, m, 'NOT_FOUND');
const conflict = (m) => new AppError(409, m, 'CONFLICT');
module.exports = { AppError, bad, unauthorized, forbidden, notFound, conflict };
