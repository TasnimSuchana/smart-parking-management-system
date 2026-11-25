# Security audit report

**Scope and honesty note.** Performed offline: no network, no Docker, no running stack, no `npm install`. The result is a code review plus the automated checks listed below. It is **not** a penetration test and the application must not be considered "100% secure". Items marked *Not verified* need to be run on your machine.

## Controls implemented (by checklist item)
| # | Item | Status | Where |
|---|---|---|---|
| 1-2 | Secrets / env variables | Implemented. No secrets in source; `.env.example` has placeholders; services fail to start if a required secret is missing or too short; compose uses `${VAR:?}` | `shared/env.js`, `docker-compose.yml` |
| 3, 5, 24 | Admin routes, RBAC, privilege escalation | Server-side `requireRole` on every protected route; registration never accepts `role` (strict schemas); no role-change endpoint, no endpoint that creates admins; admins cannot be suspended via API; two roles only (admin, user); guests are denied everywhere except register/login | `shared/middleware.js`, services |
| 4, 20 | Authentication/token handling | HS256 JWT with iss/aud/exp checks and alg pinning; 15 min access + 7 d rotating refresh in HttpOnly SameSite=Strict cookies; refresh reuse detection revokes all sessions; logout/password change/suspension revoke sessions | `auth-service`, `shared/jwt.js` |
| 6 | Validation | Zod `.strict()` schemas on bodies/queries | all services |
| 7 | XSS | React escaping, no `dangerouslySetInnerHTML`/`innerHTML`, CSP in nginx and Helmet on APIs, CSV formula-injection guard on export | `nginx.conf`, `analytics-service` |
| 8 | NoSQL injection | `$`/dotted keys stripped from body/query/params; Zod type checks; regex inputs escaped | `shared/middleware.js` |
| 9, 22 | Rate limiting | Global 300/min, auth 20/15 min, booking 60/min at gateway; violations written to audit log; account lockout after 5 failures | `api-gateway`, `auth-service` |
| 10, 22 | Endpoint security | Camera endpoints admin-only; locations, slots, prices and sockets require login; no public camera stream exists (frames processed in memory, never stored); `/internal` blocked at gateway and key-protected | `camera-service`, gateway |
| 11 | CORS | Strict allow-list from `CORS_ORIGINS`; credentials only for allow-listed origins | gateway |
| 12 | Headers | Helmet everywhere; nginx CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy | |
| 13 | Debug mode | `NODE_ENV=production`; error handler returns generic 500, stack traces never sent | `shared/middleware.js` |
| 14-15 | Dependencies | Minimal dependency list, all pinned to caret ranges. **Not verified**: `npm audit` (no network) | `backend/package.json`, `frontend/package.json` |
| 16 | Exposed config | `.dockerignore`/`.gitignore` exclude env files; `security-scan.sh` finds none | |
| 17 | MongoDB | `--auth`, per-service least-privilege users, internal network only, no published port | compose, `mongo-init.sh` |
| 18 | Passwords | scrypt N=2^15, r=8, p=1, per-user salt, constant-time compare, policy enforced; timing equalised for unknown emails | `shared/password.js` |
| 19 | Git history | **Not verified**: project had no Git repository in the sandbox. Run `gitleaks detect` / `trufflehog` before publishing | |
| 21, 25 | File access / uploads | Only upload is a raw JPEG camera frame: size-limited (2 MB), magic-byte checked, never written to disk | `camera-service` |
| 23 | Booking manipulation | Price server-computed; DB-level overlap prevention; ownership checks in queries; single-use atomic QR transitions; booking-rate alerts | `booking-service` |
| - | Encryption | Vehicle plates AES-256-GCM at rest with HMAC blind index; key from env; TLS expected at the edge | `shared/secure.js` |
| - | CSRF | SameSite=Strict + double-submit token on all cookie-authenticated mutations | `shared/middleware.js` |
| - | Containers | Non-root users, read-only filesystems, `cap_drop: ALL`, `no-new-privileges`, health checks | compose, Dockerfiles |

## Added with the booking, payment and analytics features
- Prices, availability, payment status and user identity are never taken from the browser: quotes and totals are calculated by the server, availability is re-checked at booking, and the database rejects overlapping bookings.
- Test payments (`ENABLE_DEMO_PAYMENT`) let a user mark their own booking paid without paying. They are OFF by default, labelled as simulated everywhere (invoice, transaction list), and must stay off in production unless a real gateway confirms payments.
- Invoices and transaction details are visible only to the owner or an admin; other users get 404. QR verification is admin-only, logs `qr.scanned`, `qr.rejected` and `qr.invalid`, and does not change state.
- The internal vehicle endpoint now returns the full plate (internal network and key only) so invoices can print it; the plate is never stored in the payment database.

## Known limitations / residual risk
1. **Password hashing is scrypt, not Argon2id/bcrypt** (the brief allowed Argon2id or bcrypt). scrypt with these parameters is OWASP-acceptable and avoids native dependencies; swap in `argon2` inside `shared/password.js` if you need strict conformance (the stored format is versioned for migration).
2. Suspension is enforced immediately via Redis; if Redis is down the check fails open and a suspended user's access token remains valid for up to 15 minutes.
3. Gateway rate limiting, brute-force detection and camera debouncing use per-process memory; use a shared store before scaling replicas.
4. HS256 symmetric JWTs mean every service holds the signing secret. Consider RS256/EdDSA if services are run by different teams.
5. No TLS inside the compose network or at `web`; terminate TLS at a load balancer and set `COOKIE_SECURE=true`.
6. CSP allows inline *styles* (React inline style attributes). Scripts are `self` only.
7. No payment gateway, so no card data is handled (PCI scope avoided).
8. Reset-password links are logged only in non-production when SMTP is unconfigured.
9. Camera detection quality depends on the external detector and calibration; manual correction is audited.

## Automated checks actually run
`scripts/security-scan.sh` (no env files, no hard-coded secret patterns, no `eval`/`innerHTML`/web-storage use, single published port) - passed; 12 unit tests covering JWT, passwords, AES-GCM, ticket signing, sanitiser, CSRF guard, RBAC and internal-key middleware - passed.

## Recommended next steps
Run `npm audit` in both packages, `gitleaks`, an OWASP ZAP baseline scan against the running stack, and the integration suite. Rotate every secret if any `.env` was ever shared.
