import test from "node:test";
import assert from "node:assert/strict";
import { authMiddleware } from "../src/middleware/auth.js";
import { buildApiRouter } from "../src/routes/api.js";

class FakeExposureRepository {
  async getState() {
    return { status: "OK", exposureUsed: 10 };
  }

  async getTelemetry() {
    return [];
  }

  async getFleetStatus() {
    return [{ uldId: "JTN-7890" }];
  }

  async getAlerts() {
    return [];
  }

  async resetState() {
    return undefined;
  }
}

class FakeSubscriptionRepository {
  async addSubscription(subscription) {
    return subscription;
  }
}

class FakeOperationsRepository {
  async listPendingActions() {
    return [];
  }

  async listActiveWorkflows() {
    return [];
  }

  async getActions() {
    return [];
  }

  async getWorkflows() {
    return [];
  }

  async getTimeline() {
    return [];
  }
}

class FakeAnalyticsService {
  async getSummary() {
    return {
      compliantShipmentsPercent: 100,
      averageExposureMinutes: 0,
    };
  }
}

class FakeAuditStore {
  async list() {
    return [];
  }
}

class FakeReconciliationService {
  constructor() {
    this.jobs = [];
  }

  async enqueueVerification(uldId, trigger) {
    this.jobs.push({ uldId, trigger });
  }

  async listAudits() {
    return [];
  }
}

class FakeOneRecordService {
  async getUld() {
    return {
      payload: {
        "@context": "https://onerecord.iata.org/ns/cargo",
        "@id": "http://localhost:8080/api/ulds/JTN-7890",
        "@type": "LogisticsObject",
      },
    };
  }

  async createUld(payload) {
    return payload;
  }

  async updateUld(_uldId, payload) {
    return payload;
  }
}

class FakeCargoService {
  async getControlCenter() {
    return { summary: { trackedCargo: 1 }, shipments: [] };
  }

  async scanOut(payload) {
    return { event: { ...payload, action: "CargoScannedOut" } };
  }

  async scanIn(payload) {
    return { event: { ...payload, action: "CargoScannedIn" } };
  }

  async verify(payload) {
    return { event: payload };
  }

  async reload(payload) {
    return { event: { ...payload, action: "CargoReloaded" }, stopLoad: false };
  }

  async getHistory() {
    return [{ id: "evt-1", cargo_id: "AWB-78492" }];
  }

  async getLocation() {
    return { cargoId: "AWB-78492", currentLocation: "Warehouse B / Bay 4" };
  }

  async getRisk() {
    return { cargoId: "AWB-78492", riskScore: 61 };
  }

  async getVideo() {
    return { cargoId: "AWB-78492", evidence: [] };
  }

  async getReplay() {
    return { cargoId: "AWB-78492", eventId: "evt-1", keyframes: [] };
  }

  async getReplayFrame() {
    return "<svg></svg>";
  }

  async getChainOfCustody() {
    return { cargoId: "AWB-78492", chainBroken: false, timeline: [] };
  }

  async queryCopilot() {
    return { answer: "AWB-78492 was removed for customs inspection.", matches: ["AWB-78492"] };
  }
}

class FakeTelemetryPipeline {
  async process(reading) {
    return {
      risk: { risk_level: "LOW" },
      reading,
    };
  }
}

class FakeRequestIntegrityService {
  async assertTrustedRequest() {
    return { ok: true };
  }
}

function createTestConfig() {
  return {
    auth: { disabled: true },
    platform: {
      productionMode: false,
      allowSimulatorData: true,
    },
    security: {
      requestFreshnessSeconds: 300,
      integrationSignatureSecret: "test-secret",
      requireSignedIntegrations: false,
    },
    redis: { disabled: true },
    postgres: { disabled: true },
    risk: { enabled: false },
    oneRecord: { enabled: false },
    operations: {
      airlineCode: "EK",
      primaryFlightNumber: "EK202",
      originAirport: "DXB",
      destinationAirport: "LHR",
    },
  };
}

test("auth middleware rejects missing bearer token when auth enabled", async () => {
  const middleware = authMiddleware({
    auth: {
      disabled: false,
      issuer: "http://example.com",
      audience: "api",
      jwksUri: "http://example.com/jwks",
    },
  });

  const response = createResponseRecorder();
  await middleware({ headers: {} }, response, () => {});

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error, "Missing bearer token");
});

test("status route returns data and enqueues verification when auth disabled", async () => {
  const reconciliationService = new FakeReconciliationService();
  const router = buildApiRouter({
    config: createTestConfig(),
    exposureRepository: new FakeExposureRepository(),
    operationsRepository: new FakeOperationsRepository(),
    analyticsService: new FakeAnalyticsService(),
    actionOrchestrator: { completeAction: async () => null },
    auditStore: new FakeAuditStore(),
    subscriptionRepository: new FakeSubscriptionRepository(),
    reconciliationService,
    oneRecordService: new FakeOneRecordService(),
    cargoService: new FakeCargoService(),
    authMiddleware: (_req, _res, next) => next(),
  });

  const routeLayer = router.stack.find(
    (layer) => layer.route?.path === "/uld/:id/status" && layer.route?.methods?.get,
  );
  assert.ok(routeLayer, "Expected /uld/:id/status route");

  const response = createResponseRecorder();
  const req = { params: { id: "JTN-7890" } };

  await routeLayer.route.stack[0].handle(req, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status.status, "OK");
  assert.deepEqual(reconciliationService.jobs, [
    { uldId: "JTN-7890", trigger: "uld_status_read" },
  ]);
});

test("strict JSON-LD create route is exposed at /ulds", async () => {
  const router = buildApiRouter({
    config: createTestConfig(),
    exposureRepository: new FakeExposureRepository(),
    operationsRepository: new FakeOperationsRepository(),
    analyticsService: new FakeAnalyticsService(),
    actionOrchestrator: { completeAction: async () => null },
    auditStore: new FakeAuditStore(),
    subscriptionRepository: new FakeSubscriptionRepository(),
    reconciliationService: new FakeReconciliationService(),
    oneRecordService: new FakeOneRecordService(),
    cargoService: new FakeCargoService(),
    authMiddleware: (_req, _res, next) => next(),
  });

  const routeLayer = router.stack.find(
    (layer) => layer.route?.path === "/ulds" && layer.route?.methods?.post,
  );
  assert.ok(routeLayer, "Expected /ulds POST route");

  const response = createResponseRecorder();
  const req = {
    headers: { "content-type": "application/ld+json" },
    body: {
      "@context": "https://onerecord.iata.org/ns/cargo",
      "@type": "LogisticsObject",
      serialNumber: "JTN-7890",
    },
  };

  await routeLayer.route.stack[0].handle(req, response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.headers["Content-Type"], "application/ld+json");
  assert.equal(response.body.serialNumber, "JTN-7890");
});

test("strict JSON-LD create route rejects non JSON-LD content type", async () => {
  const router = buildApiRouter({
    config: createTestConfig(),
    exposureRepository: new FakeExposureRepository(),
    operationsRepository: new FakeOperationsRepository(),
    analyticsService: new FakeAnalyticsService(),
    actionOrchestrator: { completeAction: async () => null },
    auditStore: new FakeAuditStore(),
    subscriptionRepository: new FakeSubscriptionRepository(),
    reconciliationService: new FakeReconciliationService(),
    oneRecordService: new FakeOneRecordService(),
    cargoService: new FakeCargoService(),
    authMiddleware: (_req, _res, next) => next(),
  });

  const routeLayer = router.stack.find(
    (layer) => layer.route?.path === "/ulds" && layer.route?.methods?.post,
  );
  assert.ok(routeLayer, "Expected /ulds POST route");

  const response = createResponseRecorder();
  const req = {
    headers: { "content-type": "application/json" },
    body: {
      "@context": "https://onerecord.iata.org/ns/cargo",
      "@type": "LogisticsObject",
      serialNumber: "JTN-7890",
    },
  };

  await routeLayer.route.stack[0].handle(req, response);

  assert.equal(response.statusCode, 415);
  assert.equal(response.body.error, "Content-Type must be application/ld+json");
});

test("cargo chain-of-custody route returns shipment summary", async () => {
  const router = buildApiRouter({
    config: createTestConfig(),
    exposureRepository: new FakeExposureRepository(),
    operationsRepository: new FakeOperationsRepository(),
    analyticsService: new FakeAnalyticsService(),
    actionOrchestrator: { completeAction: async () => null },
    auditStore: new FakeAuditStore(),
    subscriptionRepository: new FakeSubscriptionRepository(),
    reconciliationService: new FakeReconciliationService(),
    oneRecordService: new FakeOneRecordService(),
    cargoService: new FakeCargoService(),
    authMiddleware: (_req, _res, next) => next(),
  });

  const routeLayer = router.stack.find(
    (layer) => layer.route?.path === "/cargo/chain-of-custody/:id" && layer.route?.methods?.get,
  );
  assert.ok(routeLayer, "Expected /cargo/chain-of-custody/:id route");

  const response = createResponseRecorder();
  const req = { params: { id: "AWB-78492" } };
  await routeLayer.route.stack[0].handle(req, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.cargoId, "AWB-78492");
  assert.equal(response.body.chainBroken, false);
});

test("cargo replay route returns replay metadata", async () => {
  const router = buildApiRouter({
    config: createTestConfig(),
    exposureRepository: new FakeExposureRepository(),
    operationsRepository: new FakeOperationsRepository(),
    analyticsService: new FakeAnalyticsService(),
    actionOrchestrator: { completeAction: async () => null },
    auditStore: new FakeAuditStore(),
    subscriptionRepository: new FakeSubscriptionRepository(),
    reconciliationService: new FakeReconciliationService(),
    oneRecordService: new FakeOneRecordService(),
    cargoService: new FakeCargoService(),
    authMiddleware: (_req, _res, next) => next(),
  });

  const routeLayer = router.stack.find(
    (layer) => layer.route?.path === "/cargo/video/:id/:eventId/replay" && layer.route?.methods?.get,
  );
  assert.ok(routeLayer, "Expected /cargo/video/:id/:eventId/replay route");

  const response = createResponseRecorder();
  const req = { params: { id: "AWB-78492", eventId: "evt-1" } };
  await routeLayer.route.stack[0].handle(req, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.eventId, "evt-1");
});

test("platform-native control tower route returns live operational payload", async () => {
  const router = buildApiRouter({
    config: createTestConfig(),
    exposureRepository: new FakeExposureRepository(),
    operationsRepository: new FakeOperationsRepository(),
    analyticsService: new FakeAnalyticsService(),
    actionOrchestrator: { completeAction: async () => null },
    auditStore: new FakeAuditStore(),
    subscriptionRepository: new FakeSubscriptionRepository(),
    reconciliationService: new FakeReconciliationService(),
    oneRecordService: new FakeOneRecordService(),
    cargoService: new FakeCargoService(),
    authMiddleware: (_req, _res, next) => next(),
  });

  const routeLayer = router.stack.find(
    (layer) => layer.route?.path === "/control-tower" && layer.route?.methods?.get,
  );
  assert.ok(routeLayer, "Expected /control-tower route");

  const response = createResponseRecorder();
  await routeLayer.route.stack[0].handle({}, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.summary.trackedCargo, 1);
  assert.equal(response.body.summary.trackedUlds, 1);
});

test("platform-native ai-ops query route proxies cargo operational reasoning", async () => {
  const router = buildApiRouter({
    config: createTestConfig(),
    exposureRepository: new FakeExposureRepository(),
    operationsRepository: new FakeOperationsRepository(),
    analyticsService: new FakeAnalyticsService(),
    actionOrchestrator: { completeAction: async () => null },
    auditStore: new FakeAuditStore(),
    subscriptionRepository: new FakeSubscriptionRepository(),
    reconciliationService: new FakeReconciliationService(),
    oneRecordService: new FakeOneRecordService(),
    cargoService: new FakeCargoService(),
    authMiddleware: (_req, _res, next) => next(),
  });

  const routeLayer = router.stack.find(
    (layer) => layer.route?.path === "/ai-ops/query" && layer.route?.methods?.post,
  );
  assert.ok(routeLayer, "Expected /ai-ops/query route");

  const response = createResponseRecorder();
  await routeLayer.route.stack[0].handle({ body: { prompt: "Why was AWB-78492 removed?" } }, response);

  assert.equal(response.statusCode, 200);
  assert.match(response.body.answer, /customs inspection/i);
  assert.equal(response.body.prompt, "Why was AWB-78492 removed?");
});

test("signed HTTP IoT ingestion route accepts validated telemetry payload", async () => {
  const router = buildApiRouter({
    config: createTestConfig(),
    exposureRepository: new FakeExposureRepository(),
    operationsRepository: new FakeOperationsRepository(),
    analyticsService: new FakeAnalyticsService(),
    actionOrchestrator: { completeAction: async () => null },
    auditStore: new FakeAuditStore(),
    subscriptionRepository: new FakeSubscriptionRepository(),
    reconciliationService: new FakeReconciliationService(),
    oneRecordService: new FakeOneRecordService(),
    cargoService: new FakeCargoService(),
    telemetryPipeline: new FakeTelemetryPipeline(),
    requestIntegrityService: new FakeRequestIntegrityService(),
    authMiddleware: (_req, _res, next) => next(),
  });

  const routeLayer = router.stack.find(
    (layer) => layer.route?.path === "/integrations/iot/http" && layer.route?.methods?.post,
  );
  assert.ok(routeLayer, "Expected /integrations/iot/http route");

  const response = createResponseRecorder();
  await routeLayer.route.stack[0].handle(
    {
      headers: {
        "x-event-id": "evt-12345678",
        "x-timestamp": new Date().toISOString(),
        "x-nonce": "nonce-12345678",
      },
      body: {
        uld_id: "ULD-1234",
        timestamp: new Date().toISOString(),
        temperature_celsius: 4.5,
        lat: 25.2532,
        lon: 55.3657,
      },
    },
    response,
  );

  assert.equal(response.statusCode, 202);
  assert.equal(response.body.accepted, true);
  assert.equal(response.body.uldId, "ULD-1234");
});

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
}
