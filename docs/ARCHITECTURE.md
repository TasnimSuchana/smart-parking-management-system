# Architecture and data model

Each service owns one MongoDB database (`<svc>_db`) accessed with its own user (`readWrite` on that database only; created by `infrastructure/mongo/mongo-init.sh`). Services never read each other's databases; they call internal HTTP endpoints (shared key, internal network) or consume RabbitMQ events (topic exchange `parking.events`).

## Collections
| Service | Collection | Key fields / indexes |
|---|---|---|
| auth | User | email (unique), passwordHash (scrypt), role, status, failedLogins, lockUntil, resetTokenHash/Expires. Redis: `rt:<jti>`, `rtu:<user>`, `suspended:<user>` |
| user | Profile | userId (unique), name, email, phone |
| parking | Location | name, address, city, contact, active; text index |
| parking | Slot | locationId, label (unique per location), category, status |
| booking | Booking | userId, locationId, slotId, start, end, status, buckets[] (**partial unique multikey index** prevents double booking), nonce, quote, finalAmount, entryAt, exitAt |
| vehicle | Vehicle | userId, plateEnc (AES-256-GCM), plateIdx (HMAC blind index, unique per user), type |
| payment | PricingRule | locationId (unique), rule |
| payment | Payment | bookingId (unique), amount, status, method |
| camera | CameraZone | locationId, slots[{slotId, rect}], thresholds |
| camera | MonitoringSession | userId, zoneId, status, lastHeartbeat |
| notification | Notification | userId, title, message, read (TTL 90 d) |
| analytics | Fact | type, locationId, vehicleType, amount, at |
| audit | AuditLog | action, actorId, actorRole, ip, severity, meta (TTL 1 y) |

MongoDB 6.0+ is required (`$in` in the partial index filter).

## Events
`user.registered`, `slot.updated`, `booking.created|cancelled|entry|exit|expired`, `payment.recorded`, `camera.detection|session`, `audit.*`, `alert.*`, `notify.admin_alert`, `email.password_reset`.

## Booking and ticket flow
Create -> server validates vehicle ownership, slot state, computes price -> inserts booking with hourly bucket keys (DB rejects overlaps -> 409). Ticket = `bookingId.exp.nonce.HMAC`. Entry/exit are atomic `findOneAndUpdate` state transitions (`reserved -> active -> completed`), so a ticket works once per action. Exit bills any overstay.

## Pricing
`price = sum over hours( baseHourly x vehicleMultiplier x peakMultiplier )`, capped per 24 h block at `dailyRate x vehicleMultiplier`, then x demand multiplier from occupancy. Implemented in `backend/shared/pricing.js` (unit tested).
