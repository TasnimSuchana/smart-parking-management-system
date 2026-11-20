# Smart Parking Management System

React + Node.js/Express microservices + MongoDB, orchestrated with Docker Compose. Two roles (Admin and User). Guests can only see the home, sign-in and register pages: locations, slots and prices require a login, real-time slot updates (Socket.IO over RabbitMQ events), signed QR tickets, dynamic pricing, phone-camera monitoring with a pluggable YOLO detector, analytics with CSV/PDF export, and an audit/security trail.

> **Status:** this code was written and statically checked in an offline sandbox. Docker images were **not built** and the stack was **not run** there. See `docs/TESTING_REPORT.md` for exactly what was and was not verified. Run the checks below on your machine before relying on it.

## Architecture

```
Browser -> web (nginx, serves React, proxies /api and /socket.io)
        -> api-gateway (CORS, rate limits, routing)
        -> auth | user | parking | booking | vehicle | payment | camera | notification | analytics | audit
        -> MongoDB (one database + one least-privilege user per service) | Redis | RabbitMQ
```
Only `web` publishes a host port. All other containers sit on an internal Docker network. Details: `docs/ARCHITECTURE.md`.

## Quick start

Requirements: Docker 24+ with Compose v2, openssl.

```bash
unzip smart-parking-management-system.zip && cd smart-parking-management-system
cp .env.example .env
sh scripts/generate-secrets.sh        # paste the output over the CHANGE_ME values in .env
# also set ADMIN_EMAIL / ADMIN_PASSWORD (first admin account)
docker compose config -q              # validates the compose file and that no variable is missing
docker compose up -d --build
docker compose ps                     # wait until services are healthy
```
Open http://localhost:8080 and sign in with the admin credentials. Then:
1. Admin -> Locations & slots: create a location and add slots.
2. Admin -> Pricing: review the default rules.
3. Register a customer (any account created on the Register page is a customer), add a vehicle, book a slot and open the QR ticket.
4. Admin -> Scan QR tickets: paste the ticket code and record entry and exit. Admin -> Transactions / Awaiting payment records payment.

Remove `ADMIN_PASSWORD` from `.env` after first start. Stop with `docker compose down` (data persists in volumes; add `-v` to wipe).

## Production notes
- Put TLS in front of the `web` container (cloud load balancer or certbot) and set `COOKIE_SECURE=true`, `PUBLIC_URL=https://your.domain`.
- Rotate any secret that has ever been committed or shared. Removing it from the latest source does not make it safe.
- Rate limits, brute-force detection and the camera frame debounce keep state in process memory; with more than one replica of those services, move that state to Redis.

## Camera monitoring
Admins open the page on a phone (HTTPS required by browsers for camera access, `localhost` excepted). An admin creates a zone per fixed camera position and **calibrates** it by drawing a rectangle per slot on a captured still. Frames are sent every 3 s to `camera-service`, which calls a detector at `DETECTOR_URL`. **No detector is bundled**: provide an inference server exposing `POST /detect` (body `image/jpeg`) returning `{"detections":[{"label":"car","confidence":0.9,"box":{"x":0.1,"y":0.2,"w":0.2,"h":0.3}}]}` with normalised boxes (e.g. a small FastAPI wrapper around Ultralytics YOLO). Without it, detection returns 503 and operators use manual correction. A slot changes only after N consecutive consistent frames.

## Payments
No payment gateway is integrated (requires merchant credentials). Charges are created at exit; the admin records on-site settlement. Plug a gateway into `payment-service` (`PATCH /:id/paid` is the integration point).

## Development
```bash
cd backend && npm install && npm test            # unit tests (no DB needed)
cd frontend && npm install && npm run dev         # needs the gateway on :4000
BASE_URL=http://localhost:8080 npm run test:integration --prefix backend   # against a running stack
sh scripts/security-scan.sh
```

## Documentation
`docs/API.md`, `docs/ARCHITECTURE.md` (schemas, events), `docs/SECURITY_AUDIT.md`, `docs/TESTING_REPORT.md`.
