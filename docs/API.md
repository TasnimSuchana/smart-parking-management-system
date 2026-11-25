# API reference

Base: `/api/v1`. Responses: `{ "success": true, "data": ..., "meta": {page,limit,total} }` or `{ "success": false, "error": { "code", "message", "details?" } }`.
Auth: HttpOnly cookies (`access_token` 15 min, `refresh_token` 7 d rotating) set by login/register. State-changing requests with cookies must send `X-CSRF-Token` equal to the `csrf` cookie. Roles: **U** signed-in user (customer), **A** admin. Guests (no login) can only call register, login, forgot/reset password and refresh; every other endpoint returns 401. Paginated lists accept `page`, `limit` (max 100).

## /auth
| Method | Path | Who | Notes |
|---|---|---|---|
| POST | /auth/register | guest | name, email, password (policy). Role is always `user`. |
| POST | /auth/login | guest | 5 failures lock the account 15 min; rate limited |
| POST | /auth/refresh | cookie | rotates refresh token; reuse revokes all sessions |
| POST | /auth/logout | any | revokes refresh token |
| GET | /auth/me | U A | |
| POST | /auth/change-password | U A | revokes all sessions |
| POST | /auth/forgot-password | guest | identical response for any email |
| POST | /auth/reset-password | guest | token valid 30 min, single use |

## /users
GET/PUT `/users/me` (U). A: GET `/users?q&role`, PATCH `/users/:id/status` {active|suspended}.

## /parking
U A (login required): GET `/parking/locations?q&city`, `/locations/:id`, `/locations/:id/slots?status&category`.
A: POST/PUT/DELETE `/locations`, GET `/admin/locations`, POST `/locations/:id/slots` ({label} or {prefix,count,category}), PUT/DELETE `/slots/:id`.
A: PATCH `/slots/:id/status` {available|occupied|reserved|maintenance}.

## /bookings and /qr
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /bookings/slot/:slotId/busy | guest | booked windows only, no personal data |
| POST | /bookings | U | slotId, vehicleId, start, end (1-24 h). Price computed server-side. 409 on overlap |
| GET | /bookings, /bookings/:id | owner | |
| POST | /bookings/:id/cancel | owner | at least 1 h before start |
| GET | /bookings/:id/ticket | owner | signed token for the QR code |
| GET | /bookings/daily?date | A | all locations |
| POST | /qr/scan | A | {token, action: entry\|exit}; single-use transitions |

### Booking flow additions
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /bookings/availability?locationId&start&end | U A | slot ids already booked in that window (max 24 h) |
| POST | /qr/verify | A | {token} verifies signature, booking, time window and payment without changing anything; returns `nextAction` entry, exit or none |

Booking responses include `bookingNo` (for example `SP-4F7K2Q`). A conflict on create returns 409 "Sorry, this slot was just taken. Please select another slot."

## /vehicles (U A, owner only)
GET, POST `{plate,type,make?,model?,color?}`, PUT/DELETE `/:id`.

## /payments
U A (login required): GET `/payments/pricing?locationId`, POST `/payments/quote`. U: GET `/payments/me`. A: GET `/payments/pending`, PATCH `/payments/:id/paid` {method}, GET `/payments`, PUT `/payments/pricing`.

### Payments and invoices
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /payments/config | U A | `{demoPaymentEnabled, gateway: null}` |
| GET | /payments/pricing/summary | U A | default and per-location hourly rates |
| GET | /payments/me?bookingId&status | U | own transactions |
| GET | /payments/:id | owner, A | transaction details |
| GET | /payments/:id/invoice | owner, A | PDF invoice |
| POST | /payments/demo-pay | U | {bookingId, outcome: success or fail}; only when `ENABLE_DEMO_PAYMENT=true`; simulated, never real money |
| GET | /payments?status&method&q | A | statuses pending, paid, failed, refunded |
| PATCH | /payments/:id/paid | A | {method}; on-site settlement |

A payment record (status pending, with a transaction ID and invoice number) is created with every booking. The pricing rule accepts optional `serviceFee` and `discountPercent`. Quotes return `lines` (parking fee, peak surcharge, daily cap adjustment, high-demand surcharge, service fee, discount) and `total`.

## /camera and /monitoring (A only)
GET `/camera/zones`; POST `/camera/zones`, PUT `/camera/zones/:id/calibration`, DELETE `/camera/zones/:id`, POST `/camera/sessions`, POST `/camera/sessions/:id/heartbeat`, DELETE `/camera/sessions/:id`, POST `/camera/zones/:id/detect` (raw `image/jpeg` <= 2 MB), PATCH `/camera/zones/:id/slots/:slotId` (manual correction), GET `/monitoring/status`.

## /notifications (U A)
GET `/notifications`, PATCH `/notifications/read-all`, PATCH `/notifications/:id/read`.

## /analytics and /audit (A only)
GET `/analytics/summary`, `/analytics/overview?from&to` (occupancy by hour and day, most occupied locations and slots, revenue by location and method, booking counts, cancellation rate, average stay and booking value, top locations), `/analytics/revenue?period&from&to`, `/analytics/peak-hours`, `/analytics/vehicles`, and `/analytics/export?format=csv|pdf&period&from&to` (export follows the selected date range). GET `/audit/logs?severity&role&action`, GET `/audit/summary`.

## Realtime (Socket.IO at `/socket.io`)
A valid login cookie is required to connect. Client emits `subscribe:location` (id). Server emits `slot:updated`, `availability:changed` (a booking at that location changed), `notification`, and for admins `stats:changed` (refresh analytics), `camera:detection`, `camera:session`, `alert`.

`/internal/*` routes exist on services for service-to-service calls only; the gateway blocks them and they require `X-Internal-Key`.
