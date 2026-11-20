# Testing report

## Executed in the build sandbox (offline, no Docker, no databases)
| Check | Result |
|---|---|
| `node --test backend/tests/unit/*.test.js` (12 tests: JWT valid/expired/wrong secret-issuer-audience/alg=none/tampered; scrypt hash+policy; AES-GCM roundtrip + tamper; signed ticket verify/expiry/tamper; pricing base/vehicle/peak/daily cap/demand/invalid range; NoSQL sanitiser; CSRF guard; RBAC; internal key) | **12 passed, 0 failed** |
| `node --check` on all 11 service entry points and shared modules | passed |
| esbuild parse of every frontend `.jsx`/`.js` file and full import-graph bundle | passed (no syntax errors, no missing modules or named exports) |
| `docker-compose.yml` parsed as YAML; MongoDB has no published ports; only `web` publishes a port | passed |
| `scripts/security-scan.sh` | passed |

## Written but NOT executed (needs your environment)
| Requirement | Test asset | Status |
|---|---|---|
| Registration/login, invalid credentials, guest restrictions, unauthorised admin access (guest and user), NoSQL injection, CSRF, vehicle IDOR, quote validation, rate-limit enforcement, logout/refresh revocation | `backend/tests/integration/api.test.js` | Not run |
| Frontend utilities (validation, error mapping) | `frontend/tests/format.test.js` (vitest) | Not run |
| JWT expiry, refresh rotation reuse detection | expiry unit-tested; rotation logic reviewed but **not exercised** (needs Redis) | Partial |
| Booking conflicts, duplicate QR scan | Implemented with DB-level unique index and atomic transitions; **no automated test written** | Not tested |
| Camera permission denial / disconnection | Handled in `CameraMonitor.jsx` (denied, ended-track, heartbeat sweeper); needs manual test on a phone over HTTPS | Not tested |
| Real-time updates, reconnection | Socket.IO auto-reconnect + live indicator; needs running stack | Not tested |
| Database connection failure | `shared/db.js` retries with back-off; not simulated | Not tested |
| Mobile/tablet/desktop layout, horizontal overflow | CSS is mobile-first with wrapping grids and scroll-contained tables; **not rendered or inspected in a browser** | Not verified |
| Docker image builds, health checks, `docker compose up` | | Not run (no Docker) |
| `npm audit`, dependency install | | Not run (no network) |

Treat the integration suite and a manual smoke test (the steps in the README) as the acceptance gate. Expect to fix small integration issues on first run; they could not be shaken out offline.
