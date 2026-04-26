# AeroSentinel

AeroSentinel is an AI-powered ONE Record operational intelligence platform for air cargo.

It is not just a dashboard. It is a shared cargo operating layer that combines:

- ONE Record logistics objects
- ONE Record logistics events
- JSON-LD linked data
- digital twin modeling
- real-time IoT telemetry
- AI operational reasoning
- multi-party intervention workflows
- cargo chain-of-custody intelligence
- full audit and replayability

The goal is simple: every authorized stakeholder sees the same cargo truth, the same live condition state, the same event history, and the same intervention status.

## Production Posture

AeroSentinel runs in two modes:

- development mode: simulator connectors and local fallbacks are allowed for engineering workflows
- production mode: live integrations and validated sources only

Production mode should use:

- `NODE_ENV=production`
- `ALLOW_SIMULATOR_DATA=false`
- `REQUIRE_SIGNED_INTEGRATIONS=true`
- `CARGO_SEED_DEMO=false`

In production mode, the platform must not rely on:

- hardcoded operational metrics
- placeholder control-tower summaries
- dummy alerts
- synthetic shipment data
- mock serverless APIs

The legacy mock serverless handler in `backend/api/index.js` is now fail-closed so production deployments must use the live Express backend.

## Platform Vision

AeroSentinel is designed to be the shared intelligence layer across:

- airline
- freight forwarder
- shipper
- warehouse
- customs
- ground handler
- truck operator
- consignee
- regulator
- IoT provider

Instead of fragmented cargo tools, AeroSentinel provides:

- shared cargo state
- shared event history
- shared telemetry
- shared alerts
- shared intervention plans
- shared audit trail

## Core Operating Loop

`Sense -> Analyze -> Predict -> Act -> Verify -> Audit`

Every operational or environmental signal becomes an event. Every event can update the digital twin, trigger risk scoring, create tasks, notify stakeholders, and be verified against the operational state.

## ONE Record Native Model

The platform treats ONE Record as the cargo digital twin API layer.

Current modeling in the repo includes:

- `LogisticsObject` for ULD and cargo twin payloads
- `TemperatureRecord`
- `Location`
- `TemperatureComplianceStatus`
- `RiskAssessment`
- `OperationalContext`

Platform target model also includes:

- Cargo Piece
- ULD
- Sensor
- Location
- Handling Event
- Exposure Event
- Intervention Task
- Condition Status

The backend serves strict JSON-LD for the ONE Record object layer:

- `GET /api/ulds/:id`
- `POST /api/ulds`
- `PATCH /api/ulds/:id`

Compatible aliases are also exposed under:

- `GET /api/one-record/ulds/:id`
- `POST /api/one-record/ulds`
- `PATCH /api/one-record/ulds/:id`

## Digital Twin Architecture

AeroSentinel uses a hybrid model:

- Redis is the fast operational state layer
- ONE Record is the auditable linked-data twin
- Postgres or TimescaleDB is the durable ledger and evidence store
- Socket.IO provides realtime operational updates

High-level flow:

`IoT Sensors -> MQTT -> Ingestion API -> Exposure / Custody Engines -> Risk Engine -> Intervention Engine -> Verification Queue -> ONE Record Sync -> Digital Twin`

The repo already implements:

- Redis-backed operational reads
- BullMQ-backed verification jobs
- ONE Record sync and reconciliation
- JSON-LD digital twin writes
- append-only cargo custody ledger
- realtime event streaming
- signed HTTP ingestion for trusted IoT senders
- OpenAPI and JSON Schema contract endpoints
- Twilio, flight, and METAR adapter services

Trusted HTTP telemetry ingestion is exposed at:

- `POST /api/integrations/iot/http`

Required headers:

- `x-event-id`
- `x-timestamp`
- `x-nonce`
- `x-signature` when signed integrations are enforced

The request signature is derived from:

`<timestamp>.<nonce>.<eventId>.<json-body>`

Contract discovery endpoints:

- `GET /api/contracts/openapi.json`
- `GET /api/contracts/schemas/:name`

Reference shipment dataset endpoint:

- `GET /api/shipments/reference`

This reference shipment is normalized from a provided ONE Record shipment dataset and includes shipment, pieces, dimensions, and waybill structure for graph-aware UI and integration work.

## Cargo Chain-Of-Custody

The platform now includes a cargo chain-of-custody module for tracking when cargo is:

- removed from aircraft, ULD, or storage zone
- transferred to inspection, customs, or security hold
- staged in warehouse, cold room, bonded area, or truck dock
- repacked, relabeled, or reopened
- scanned back in and reloaded
- flagged missing, damaged, tampered, or in custody violation

Each custody event is append-only and hash-linked for immutable-style audit behavior.

Event examples include:

- `CargoUnloaded`
- `CargoScannedOut`
- `CargoTransferred`
- `CargoInspected`
- `CargoHeld`
- `CargoOpened`
- `CargoRepacked`
- `CargoScannedIn`
- `CargoReloaded`
- `CargoMissing`
- `CargoDamaged`
- `CargoTamperAlert`
- `CustodyViolation`

The system computes:

- custody state
- outside-custody duration
- cargo integrity score
- theft and tamper risk
- stop-load decisions
- recommended interventions

## Camera Replay And Anomaly Playback

Cargo evidence is no longer modeled as static links alone.

The backend now exposes replay-oriented APIs:

- `GET /api/cargo/video/:cargoId`
- `GET /api/cargo/video/:cargoId/:eventId/replay`
- `GET /api/cargo/video/:cargoId/:eventId/frame/:frameIndex`

These APIs return:

- replay metadata
- anomaly markers
- keyframes
- generated playback frames
- operator-friendly forensic playback context

The custody UI includes playback controls for:

- open replay
- play and pause
- scrub timeline
- jump to anomaly markers
- inspect rendered replay frames

## AI Operational Intelligence

AeroSentinel reasons over operational graph context, not just isolated sensor rows.

The current platform supports:

- predictive thermal risk scoring
- intervention recommendations
- custody risk and integrity scoring
- cargo operations copilot queries
- workflow and alert creation from live events

Target AI reasoning questions include:

- Why is cargo risk increasing?
- What event caused the exposure?
- Which airport or handler creates repeated dwell failures?
- Which shipment has the highest theft risk?
- What is the next likely failure node?
- Which intervention has the highest recovery value?

## Event-Driven Execution

The platform is event-native.

When a condition or operational state changes, AeroSentinel can:

- publish an event
- update Redis operational state
- update the ONE Record twin
- append to the custody ledger
- trigger alerts
- create tasks and workflows
- notify subscribers
- emit live websocket updates

Current event subscribers and notifications are implemented through:

- webhook subscriptions
- email notifications
- realtime dashboard events

Current validation and trust controls include:

- strict JSON-LD validation for ONE Record write endpoints
- request-body validation on cargo mutation routes
- bounded AI Ops query validation
- signed HTTP IoT ingestion with freshness, nonce, and replay checks
- geo and telemetry plausibility validation at ingestion time
- shared schema definitions for telemetry, cargo, AI Ops, Twilio, WhatsApp, METAR, and flight queries

Integration adapters now present in the backend:

- Twilio SMS, WhatsApp, and voice adapter with webhook signature verification
- flight-data adapter with live-provider normalization
- METAR lookup adapter for airport weather
- ONE Record reference shipment dataset exposure

The target architecture also anticipates:

- customs subscriptions
- shipper subscriptions
- consignee subscriptions
- delegated event sharing
- broader pub/sub distribution

## Access Control

The repo includes Keycloak-oriented OAuth2 support and ONE Record token management.

Current capabilities:

- bearer-token middleware
- Keycloak issuer and JWKS config
- ONE Record token caching in Redis
- request-signature validation support for trusted integrations

Frontend production gating:

- API-backed platform pages remain available
- legacy store-driven pages are explicitly gated in production mode so seeded UI state cannot appear as live operational data

Target access model:

- RBAC
- delegated permissions
- federated graph sharing
- stakeholder-specific graph segment visibility

## Control Tower UX

The frontend is a real multi-page application with dense operational views rather than a single-screen mockup.

Current routes:

- `/dashboard`
- `/flights`
- `/uld-tracking`
- `/exposure`
- `/interventions`
- `/cargo-custody`
- `/alerts`
- `/airports`
- `/analytics`

Current page intent:

- `Dashboard`: control-tower summary and entry point
- `Flights`: long-haul operational context
- `ULD Tracking`: live ULD movement and condition
- `Exposure`: thermal and environmental analysis
- `Interventions`: tasks, workflows, and operator coordination
- `Cargo Custody`: movement ledger, replay, integrity, and theft/tamper review
- `Alerts`: exception monitoring
- `Airports`: airport and zone intelligence
- `Analytics`: compliance and performance

Target page map:

- `/control-tower`
- `/cargo-graph`
- `/live-events`
- `/thermal-map`
- `/exposure`
- `/interventions`
- `/stakeholders`
- `/compliance`
- `/audit`
- `/ai-ops`

## Operational APIs

Current backend APIs include:

- `GET /api/health`
- `GET /api/platform`
- `GET /api/fleet`
- `GET /api/control-center`
- `GET /api/flights`
- `GET /api/analytics`
- `GET /api/alerts`
- `GET /api/audit`
- `GET /api/verification/audit`
- `GET /api/uld/:id/status`
- `GET /api/uld/:id/actions`
- `GET /api/uld/:id/workflows`
- `GET /api/uld/:id/timeline`
- `POST /api/actions/:id/complete`
- `POST /api/alert/subscribe`
- `POST /api/uld/:id/reset`

Current cargo APIs include:

- `GET /api/cargo/control-center`
- `POST /api/cargo/scan-out`
- `POST /api/cargo/scan-in`
- `POST /api/cargo/verify`
- `POST /api/cargo/reload`
- `POST /api/cargo/copilot/query`
- `GET /api/cargo/history/:id`
- `GET /api/cargo/location/:id`
- `GET /api/cargo/risk/:id`
- `GET /api/cargo/video/:id`
- `GET /api/cargo/video/:id/:eventId/replay`
- `GET /api/cargo/video/:id/:eventId/frame/:frameIndex`
- `GET /api/cargo/chain-of-custody/:id`

Target customer-facing surface also includes:

- `/risk`
- `/exposure`
- `/predictions`
- `/interventions`
- `/history`
- `/condition`
- `/audit`
- `/graphql`
- websocket streams

## Persistence And Scale Direction

The current repo supports:

- Redis for fast state
- Postgres for audit and cargo ledger persistence
- Timescale-aware schema initialization for custody events and evidence
- compression and retention policy attempts when TimescaleDB is available

The Docker stack now uses a TimescaleDB-compatible image for the database service.

Design direction for scale:

- 100M+ cargo events
- 50k concurrent users
- sub-second operational lookups
- Kafka or equivalent event streaming
- Timescale hypertables for event history
- object storage for video and evidence
- graph-centric digital twin queries
- failover and redundancy

## Repository Layout

- `backend/`: Express API, realtime engines, ONE Record sync, custody ledger, verification, and workflow orchestration
- `frontend/`: React + TypeScript operational UI
- `broker/`: local MQTT broker
- `simulator/`: telemetry and cargo custody event simulator
- `risk-service/`: predictive risk microservice
- `infra/`: Docker Compose for Redis, TimescaleDB, Keycloak, GraphDB, NE:ONE, and observability
- `docs/`: supporting API, demo, and scenario material

## Local Development

The local setup is designed to run even when Redis, Postgres, Keycloak, GraphDB, or NE:ONE are unavailable.

### Install

```bash
npm install --workspaces
```

### Start Locally

1. Start the MQTT broker:

```bash
npm run dev:broker
```

2. Start the backend in local fallback mode:

```bash
AUTH_DISABLED=true \
REDIS_DISABLED=true \
POSTGRES_DISABLED=true \
RISK_SERVICE_DISABLED=true \
ONE_RECORD_ENABLED=false \
CARGO_SEED_DEMO=false \
npm run dev:backend
```

3. Start the frontend:

```bash
npm run dev:frontend
```

4. Start the simulator for telemetry plus custody events:

```bash
MQTT_URL=mqtt://localhost:1883 \
BACKEND_URL=http://localhost:3000 \
npm run dev:simulator
```

### Local Endpoints

- Frontend dev UI: `http://localhost:5173`
- Backend app and API: `http://localhost:3000`
- Metrics: `http://localhost:3000/metrics`
- Health: `http://localhost:3000/api/health`

## Full Infrastructure Stack

To run the full hybrid stack:

```bash
docker compose -f infra/docker-compose.yml up --build
```

Primary services:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
- Risk service: `http://localhost:8010`
- Keycloak: `http://localhost:8081`
- NE:ONE: `http://localhost:8080`
- GraphDB: `http://localhost:7200`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`

## Verification

Validated in this workspace with:

```bash
npm --workspace backend test
npm --workspace frontend run typecheck
npm --workspace frontend run build
node --check backend/src/server.js
node --check simulator/src/index.js
```

## Positioning

AeroSentinel is cargo infrastructure software:

- shared truth
- live linked-data twin
- realtime event intelligence
- AI operational reasoning
- collaborative execution
- full auditability


To view updated working demo with all integrations working ; check it here :  https://drive.google.com/file/d/1oyL_eTT2e3CNbzGPZQKTQYS4E8RObFLy/view?usp=sharing

That is the direction of the platform, and this repository already implements a meaningful slice of that operating model today.
