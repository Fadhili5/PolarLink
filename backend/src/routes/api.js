import { Router } from "express";
import { buildOpenApiDocument } from "../contracts/openapi.js";
import { schemaRegistry } from "../contracts/schemas.js";
import {
  validateAiOpsQuery,
  validateAlertSubscription,
  validateCargoMutation,
  validateFlightQuery,
  validateMetarQuery,
  validateTelemetryReading,
  validateTwilioStatusWebhook,
  validateWhatsAppCommand,
} from "../contracts/validators.js";

export function buildApiRouter({
  config,
  exposureRepository,
  operationsRepository,
  analyticsService,
  actionOrchestrator,
  auditStore,
  subscriptionRepository,
  reconciliationService,
  oneRecordService,
  cargoService,
  telemetryPipeline,
  requestIntegrityService,
  weatherService,
  flightDataService,
  twilioService,
  authMiddleware,
}) {
  const router = Router();
  const strictJsonLdTypes = new Set(["application/ld+json"]);

  router.use(authMiddleware);

  router.get("/health", async (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  router.get("/contracts/openapi.json", async (_req, res) => {
    res.json(buildOpenApiDocument());
  });

  router.get("/contracts/schemas/:name", async (req, res) => {
    const schema = schemaRegistry[req.params.name];
    if (!schema) {
      return res.status(404).json({ error: "Schema not found" });
    }
    res.json(schema);
  });

  router.post("/integrations/iot/http", async (req, res) => {
    if (!telemetryPipeline || !requestIntegrityService) {
      return res.status(503).json({ error: "IoT ingestion pipeline unavailable" });
    }

    try {
      await requestIntegrityService.assertTrustedRequest({
        headers: req.headers,
        body: req.body,
        channel: "iot-http",
      });
    } catch (error) {
      return res
        .status(error.status || 400)
        .json({ error: error.message || "Invalid integration request" });
    }

    const readingValidation = validateTelemetryReading(req.body);
    if (readingValidation) {
      return res.status(readingValidation.status).json({ error: readingValidation.error });
    }

    const event = await telemetryPipeline.process(req.body);
    res.status(202).json({
      accepted: true,
      uldId: req.body.uld_id,
      timestamp: req.body.timestamp,
      riskLevel: event.risk?.risk_level || null,
    });
  });

  router.get("/uld/:id/status", async (req, res) => {
    await reconciliationService.enqueueVerification(req.params.id, "uld_status_read");
    const state = await exposureRepository.getState(req.params.id);
    const telemetry = await exposureRepository.getTelemetry(req.params.id, 50);
    if (!state) {
      return res.status(404).json({ error: "ULD not found" });
    }
    res.json({ status: state, telemetry });
  });

  router.get("/fleet", async (_req, res) => {
    const fleet = await exposureRepository.getFleetStatus();
    await Promise.allSettled(
      fleet.slice(0, 50).map((item) =>
        reconciliationService.enqueueVerification(item.uldId, "fleet_read"),
      ),
    );
    res.json(fleet);
  });

  router.get("/alerts", async (req, res) => {
    const limit = Number.parseInt(String(req.query.limit || "25"), 10);
    res.json(await exposureRepository.getAlerts(Math.min(limit, 100)));
  });

  router.get("/analytics", async (_req, res) => {
    res.json(await analyticsService.getSummary());
  });

  router.get("/analytics/overview", async (_req, res) => {
    res.json(await buildAnalyticsOverviewPayload({
      analyticsService,
      exposureRepository,
      operationsRepository,
    }));
  });

  router.get("/shipments/reference", async (_req, res) => {
    res.setHeader("Content-Type", "application/ld+json");
    res.json(await oneRecordService.getReferenceShipment());
  });

  router.get("/shipments", async (req, res) => {
    const limit = Math.min(Number.parseInt(String(req.query.limit || "20"), 10), 100);
    res.setHeader("Content-Type", "application/ld+json");
    res.json(await oneRecordService.listShipments({ limit }));
  });

  router.get("/shipments/:id", async (req, res) => {
    const shipment = await oneRecordService.getShipment(req.params.id);
    if (!shipment) {
      return res.status(404).json({ error: "Shipment not found" });
    }
    res.setHeader("Content-Type", "application/ld+json");
    res.json(shipment);
  });

  router.get("/control-tower", async (_req, res) => {
    res.json(await buildControlTowerPayload({
      config,
      exposureRepository,
      operationsRepository,
      analyticsService,
      cargoService,
    }));
  });

  router.get("/live-events", async (_req, res) => {
    res.json(await buildLiveEventsPayload({
      exposureRepository,
      operationsRepository,
      cargoService,
    }));
  });

  router.get("/cargo-graph", async (_req, res) => {
    res.json(await buildCargoGraphPayload({ cargoService }));
  });

  router.get("/thermal-map", async (_req, res) => {
    res.json(await buildThermalMapPayload({ exposureRepository }));
  });

  router.get("/exposure/overview", async (_req, res) => {
    res.json(await buildExposureOverviewPayload({
      exposureRepository,
      analyticsService,
    }));
  });

  router.get("/interventions/board", async (_req, res) => {
    res.json(await buildInterventionsBoardPayload({
      operationsRepository,
      exposureRepository,
    }));
  });

  router.get("/stakeholders", async (_req, res) => {
    res.json(await buildStakeholdersPayload({
      exposureRepository,
      operationsRepository,
      cargoService,
    }));
  });

  router.get("/ai-ops", async (_req, res) => {
    res.json(await buildAiOpsPayload({
      analyticsService,
      cargoService,
      operationsRepository,
      exposureRepository,
    }));
  });

  router.get("/cargo/control-center", async (_req, res) => {
    res.json(await cargoService.getControlCenter());
  });

  router.post("/cargo/scan-out", async (req, res) => {
    const validation = validateCargoMutation(req.body);
    if (validation) {
      return res.status(validation.status).json({ error: validation.error });
    }
    res.status(201).json(await cargoService.scanOut(req.body));
  });

  router.post("/cargo/scan-in", async (req, res) => {
    const validation = validateCargoMutation(req.body);
    if (validation) {
      return res.status(validation.status).json({ error: validation.error });
    }
    res.status(201).json(await cargoService.scanIn(req.body));
  });

  router.post("/cargo/verify", async (req, res) => {
    const validation = validateCargoMutation(req.body);
    if (validation) {
      return res.status(validation.status).json({ error: validation.error });
    }
    res.status(201).json(await cargoService.verify(req.body));
  });

  router.post("/cargo/reload", async (req, res) => {
    const validation = validateCargoMutation(req.body);
    if (validation) {
      return res.status(validation.status).json({ error: validation.error });
    }
    res.status(201).json(await cargoService.reload(req.body));
  });

  router.post("/cargo/copilot/query", async (req, res) => {
    const validation = validateAiOpsQuery(req.body);
    if (validation) {
      return res.status(validation.status).json({ error: validation.error });
    }
    res.json(await cargoService.queryCopilot(req.body?.prompt || ""));
  });

  router.post("/ai-ops/query", async (req, res) => {
    const validation = validateAiOpsQuery(req.body);
    if (validation) {
      return res.status(validation.status).json({ error: validation.error });
    }
    const prompt = req.body?.prompt || "";
    const response = await cargoService.queryCopilot(prompt);
    res.json({
      ...response,
      prompt,
      generatedAt: new Date().toISOString(),
    });
  });

  router.get("/weather/metar", async (req, res) => {
    const validation = validateMetarQuery(req.query);
    if (validation) {
      return res.status(validation.status).json({ error: validation.error });
    }

    const metar = await weatherService.getMetar(req.query.airport);
    if (!metar) {
      return res.status(404).json({ error: "METAR not found" });
    }
    res.json(metar);
  });

  router.post("/integrations/twilio/status", async (req, res) => {
    const validation = validateTwilioStatusWebhook(req.body);
    if (validation) {
      return res.status(validation.status).json({ error: validation.error });
    }

    const signature = req.headers["x-twilio-signature"];
    const valid = twilioService.validateWebhookSignature({
      url: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
      body: req.body,
      signature,
    });

    if (!valid) {
      return res.status(401).json({ error: "Invalid Twilio signature" });
    }

    await twilioService.recordWebhook("status", req.body);
    const mapped = await twilioService.getMappedMessage(req.body.MessageSid);
    if (mapped?.actionId && ["delivered", "read"].includes(String(req.body.MessageStatus || "").toLowerCase())) {
      await actionOrchestrator.acknowledgeAction(mapped.actionId, {
        actor: mapped.channel || "twilio",
        source: "twilio-status",
        note: `Message ${req.body.MessageStatus} for ${req.body.To || "recipient"}`,
      });
    } else if (mapped?.targetId) {
      await actionOrchestrator.attachCommunicationEvent(mapped.targetId, {
        source: "twilio-status",
        channel: mapped.channel || "sms",
        messageSid: req.body.MessageSid,
        status: req.body.MessageStatus,
        occurredAt: new Date().toISOString(),
      });
    }
    res.status(202).json({ accepted: true });
  });

  router.post("/integrations/whatsapp/commands", async (req, res) => {
    const validation = validateWhatsAppCommand(req.body);
    if (validation) {
      return res.status(validation.status).json({ error: validation.error });
    }

    const signature = req.headers["x-twilio-signature"];
    const valid = twilioService.validateWebhookSignature({
      url: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
      body: req.body,
      signature,
    });
    if (!valid) {
      return res.status(401).json({ error: "Invalid Twilio signature" });
    }

    await twilioService.recordWebhook("whatsapp-command", req.body);
    const command = String(req.body.Body || "").trim();
    const targetId = extractTargetId(command);
    const lower = command.toLowerCase();

    let action = null;
    if (targetId && lower.includes("/ack")) {
      action = await actionOrchestrator.acknowledgeFirstOpenAction(targetId, {
        actor: req.body.From,
        source: "whatsapp-command",
        note: command,
      });
    } else if (targetId && (lower.includes("/complete") || lower.includes("/done"))) {
      action = await actionOrchestrator.completeFirstOpenAction(targetId, {
        actor: req.body.From,
        source: "whatsapp-command",
        note: command,
      });
    } else if (targetId && lower.includes("/escalate")) {
      await actionOrchestrator.escalateOpenActions(targetId, {
        actor: req.body.From,
        source: "whatsapp-command",
        note: command,
      });
    }

    if (targetId) {
      await actionOrchestrator.attachCommunicationEvent(targetId, {
        source: "whatsapp-command",
        channel: "whatsapp",
        from: req.body.From,
        body: command,
        occurredAt: new Date().toISOString(),
      });
    }
    res.status(202).json({
      accepted: true,
      command,
      from: req.body.From,
      targetId,
      actionId: action?.id || null,
    });
  });

  router.get("/cargo/history/:id", async (req, res) => {
    const history = await cargoService.getHistory(req.params.id);
    if (!history.length) {
      return res.status(404).json({ error: "Cargo history not found" });
    }
    res.json(history);
  });

  router.get("/cargo/location/:id", async (req, res) => {
    const location = await cargoService.getLocation(req.params.id);
    if (!location) {
      return res.status(404).json({ error: "Cargo location not found" });
    }
    res.json(location);
  });

  router.get("/cargo/risk/:id", async (req, res) => {
    const risk = await cargoService.getRisk(req.params.id);
    if (!risk) {
      return res.status(404).json({ error: "Cargo risk not found" });
    }
    res.json(risk);
  });

  router.get("/cargo/video/:id", async (req, res) => {
    res.json(await cargoService.getVideo(req.params.id));
  });

  router.get("/cargo/video/:id/:eventId/replay", async (req, res) => {
    const replay = await cargoService.getReplay(req.params.id, req.params.eventId);
    if (!replay) {
      return res.status(404).json({ error: "Replay not found" });
    }
    res.json(replay);
  });

  router.get("/cargo/video/:id/:eventId/frame/:frameIndex", async (req, res) => {
    const svg = await cargoService.getReplayFrame(
      req.params.id,
      req.params.eventId,
      Number.parseInt(req.params.frameIndex, 10),
    );
    if (!svg) {
      return res.status(404).json({ error: "Replay frame not found" });
    }
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg);
  });

  router.get("/cargo/chain-of-custody/:id", async (req, res) => {
    const custody = await cargoService.getChainOfCustody(req.params.id);
    if (!custody) {
      return res.status(404).json({ error: "Cargo chain-of-custody not found" });
    }
    res.json(custody);
  });

  router.get("/audit", async (req, res) => {
    const limit = Number.parseInt(String(req.query.limit || "50"), 10);
    res.json(await auditStore.list(Math.min(limit, 100)));
  });

  router.get("/audit/overview", async (req, res) => {
    const limit = Number.parseInt(String(req.query.limit || "50"), 10);
    res.json(await buildAuditOverviewPayload({
      auditStore,
      reconciliationService,
      exposureRepository,
      operationsRepository,
      limit: Math.min(limit, 100),
    }));
  });

  router.get("/verification/audit", async (req, res) => {
    const limit = Number.parseInt(String(req.query.limit || "50"), 10);
    res.json(await reconciliationService.listAudits(Math.min(limit, 100)));
  });

  router.get("/platform", async (_req, res) => {
    res.json({
      apiSecurity: config.auth.disabled ? "disabled-for-local-dev" : "keycloak-jwt",
      features: {
        liveDashboard: true,
        liveAlerts: true,
        telemetryChart: true,
        digitalTwinIntegration: true,
        predictiveRisk: true,
        actionOrchestration: true,
        workflowEngine: true,
        operationalContext: true,
        verificationQueue: true,
        oneRecordDigitalTwin: true,
      },
      performanceTargets: {
        redisReadMs: 50,
        apiResponseMs: 150,
        uldScale: 10000,
      },
    });
  });

  router.get("/control-center", async (_req, res) => {
    const fleet = await exposureRepository.getFleetStatus();
    const pendingActions = await operationsRepository.listPendingActions(100);
    const workflows = await operationsRepository.listActiveWorkflows(100);
    const alerts = await exposureRepository.getAlerts(25);
    const analytics = await analyticsService.getSummary();
    const flight = config.platform.productionMode && !config.platform.allowSimulatorData
      ? null
      : {
          number: config.operations.primaryFlightNumber,
          route: `${config.operations.originAirport}-${config.operations.destinationAirport}`,
          airline: config.operations.airlineCode,
        };
    res.json({
      fleet,
      pendingActions,
      workflows,
      alerts,
      analytics,
      flight,
    });
  });

  router.get("/flights", async (_req, res) => {
    const validation = validateFlightQuery(_req.query);
    if (validation) {
      return res.status(validation.status).json({ error: validation.error });
    }

    res.json(await flightDataService.getFlights(_req.query));
  });

  async function getUldTwin(req, res) {
    const twin = await oneRecordService.getUld(req.params.id);
    if (!twin) {
      return res.status(404).json({ error: "ULD digital twin not found" });
    }
    res.setHeader("Content-Type", "application/ld+json");
    res.json(twin.payload || twin);
  }

  async function createUldTwin(req, res) {
    const validation = validateJsonLdRequest(req, strictJsonLdTypes);
    if (validation) {
      return res.status(validation.status).json({ error: validation.error });
    }

    const created = await oneRecordService.createUld(req.body);
    res.setHeader("Content-Type", "application/ld+json");
    res.status(created ? 201 : 202).json(created || { queued: true });
  }

  async function updateUldTwin(req, res) {
    const validation = validateJsonLdRequest(req, strictJsonLdTypes);
    if (validation) {
      return res.status(validation.status).json({ error: validation.error });
    }

    const updated = await oneRecordService.updateUld(req.params.id, req.body);
    res.setHeader("Content-Type", "application/ld+json");
    res.status(updated ? 200 : 202).json(updated || { queued: true });
  }

  router.get("/ulds/:id", getUldTwin);
  router.post("/ulds", createUldTwin);
  router.patch("/ulds/:id", updateUldTwin);
  router.get("/one-record/ulds/:id", getUldTwin);
  router.post("/one-record/ulds", createUldTwin);
  router.patch("/one-record/ulds/:id", updateUldTwin);

  router.post("/alert/subscribe", async (req, res) => {
    const validation = validateAlertSubscription(req.body);
    if (validation) {
      return res.status(validation.status).json({ error: validation.error });
    }

    const subscription = {
      id: `sub-${Date.now()}`,
      webhookUrl: req.body?.webhookUrl || "",
      email: req.body?.email || "",
      createdAt: new Date().toISOString(),
    };
    if (!subscription.webhookUrl && !subscription.email) {
      return res.status(400).json({ error: "webhookUrl or email required" });
    }
    await subscriptionRepository.addSubscription(subscription);
    res.status(201).json(subscription);
  });

  router.post("/uld/:id/reset", async (req, res) => {
    await exposureRepository.resetState(req.params.id);
    res.status(202).json({ reset: true, uldId: req.params.id });
  });

  router.get("/uld/:id/actions", async (req, res) => {
    res.json(await operationsRepository.getActions(req.params.id, 50));
  });

  router.get("/uld/:id/workflows", async (req, res) => {
    res.json(await operationsRepository.getWorkflows(req.params.id, 50));
  });

  router.get("/uld/:id/timeline", async (req, res) => {
    res.json(await operationsRepository.getTimeline(req.params.id, 100));
  });

  router.post("/actions/:id/complete", async (req, res) => {
    const action = await actionOrchestrator.completeAction(req.params.id);
    if (!action) {
      return res.status(404).json({ error: "Action not found" });
    }
    res.json(action);
  });

  return router;
}

function validateJsonLdRequest(req, strictJsonLdTypes) {
  const contentType = String(req.headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (!strictJsonLdTypes.has(contentType)) {
    return {
      status: 415,
      error: "Content-Type must be application/ld+json",
    };
  }

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return {
      status: 400,
      error: "JSON-LD object body required",
    };
  }

  if (!req.body["@context"]) {
    return {
      status: 400,
      error: "JSON-LD @context is required",
    };
  }

  return null;
}

async function buildControlTowerPayload({
  config,
  exposureRepository,
  operationsRepository,
  analyticsService,
  cargoService,
}) {
  const [fleet, pendingActions, workflows, alerts, analytics, cargoCenter] = await Promise.all([
    exposureRepository.getFleetStatus(),
    operationsRepository.listPendingActions(100),
    operationsRepository.listActiveWorkflows(100),
    exposureRepository.getAlerts(50),
    analyticsService.getSummary(),
    cargoService.getControlCenter(),
  ]);

  const shipments = cargoCenter.shipments || [];
  const flights = Object.values(
    shipments.reduce((accumulator, shipment) => {
      const flightKey = shipment.flight || "UNASSIGNED";
      const current = accumulator[flightKey] || {
        flight: flightKey,
        shipmentCount: 0,
        highRiskCount: 0,
        chainBrokenCount: 0,
        stopLoadCount: 0,
        latestLocation: shipment.currentLocation || null,
        lastUpdatedAt: shipment.lastUpdatedAt || null,
      };

      current.shipmentCount += 1;
      if (shipment.riskLevel === "HIGH") current.highRiskCount += 1;
      if (shipment.chainBroken) current.chainBrokenCount += 1;
      if (shipment.stopLoad) current.stopLoadCount += 1;
      if (!current.lastUpdatedAt || new Date(shipment.lastUpdatedAt).getTime() > new Date(current.lastUpdatedAt).getTime()) {
        current.lastUpdatedAt = shipment.lastUpdatedAt || current.lastUpdatedAt;
        current.latestLocation = shipment.currentLocation || current.latestLocation;
      }

      accumulator[flightKey] = current;
      return accumulator;
    }, {}),
  ).sort((left, right) => right.shipmentCount - left.shipmentCount);

  return {
    generatedAt: new Date().toISOString(),
    mode: config.nodeEnv,
    summary: {
      trackedUlds: fleet.length,
      trackedCargo: cargoCenter.summary?.trackedCargo || shipments.length,
      activeAlerts: alerts.length,
      pendingInterventions: pendingActions.length,
      activeWorkflows: workflows.length,
      chainBrokenCargo: cargoCenter.summary?.chainBrokenCount || 0,
      stopLoadCargo: cargoCenter.summary?.stopLoadCount || 0,
    },
    flights,
    fleet,
    alerts,
    pendingActions,
    workflows,
    cargo: cargoCenter,
    analytics,
    integrations: {
      oneRecord: config.oneRecord.enabled,
      redis: !config.redis.disabled,
      postgres: !config.postgres.disabled,
      riskEngine: config.risk.enabled,
      auth: !config.auth.disabled,
    },
  };
}

async function buildLiveEventsPayload({
  exposureRepository,
  operationsRepository,
  cargoService,
}) {
  const [alerts, pendingActions, workflows, cargoCenter] = await Promise.all([
    exposureRepository.getAlerts(50),
    operationsRepository.listPendingActions(100),
    operationsRepository.listActiveWorkflows(100),
    cargoService.getControlCenter(),
  ]);

  const shipments = (cargoCenter.shipments || []).slice(0, 20);
  const histories = await Promise.all(
    shipments.map(async (shipment) => ({
      cargoId: shipment.cargoId,
      history: await cargoService.getHistory(shipment.cargoId),
    })),
  );

  const events = [
    ...alerts.map((alert) => ({
      id: alert.id || `alert-${alert.uld_id || "unknown"}-${alert.occurred_at || Date.now()}`,
      category: "ALERT",
      title: alert.message || alert.status || "Operational Alert",
      detail: alert.message || "Exposure or operational alert detected.",
      timestamp: alert.occurred_at || new Date().toISOString(),
      severity: alert.status || "INFO",
      entityType: "ULD",
      entityId: alert.uld_id || null,
      source: alert.source || "telemetry",
    })),
    ...pendingActions.map((action) => ({
      id: action.id,
      category: "INTERVENTION",
      title: action.action,
      detail: `${action.assignedRole} owns ${action.action} for ${action.uldId}.`,
      timestamp: action.completedAt || action.createdAt || new Date().toISOString(),
      severity: action.priority || "NORMAL",
      entityType: "ULD",
      entityId: action.uldId,
      source: action.source || "workflow",
    })),
    ...workflows.map((workflow) => ({
      id: workflow.id,
      category: "WORKFLOW",
      title: workflow.name,
      detail: `${workflow.name} is ${workflow.status || "ACTIVE"} for ${workflow.uldId}.`,
      timestamp: workflow.updatedAt || workflow.createdAt || new Date().toISOString(),
      severity: workflow.status || "ACTIVE",
      entityType: "ULD",
      entityId: workflow.uldId,
      source: "workflow",
    })),
    ...histories.flatMap(({ cargoId, history }) =>
      history.slice(-10).map((event) => ({
        id: event.id,
        category: "CUSTODY",
        title: event.action,
        detail: `${cargoId} ${event.action} at ${event.location}.`,
        timestamp: event.timestamp,
        severity: event.risk?.riskLevel || "INFO",
        entityType: "CARGO",
        entityId: cargoId,
        source: event.team || event.handler || "cargo-ops",
      })),
    ),
  ]
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 250);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: events.length,
      alerts: alerts.length,
      interventions: pendingActions.length,
      workflows: workflows.length,
      custodyEvents: histories.reduce((sum, item) => sum + item.history.length, 0),
    },
    events,
  };
}

async function buildCargoGraphPayload({ cargoService }) {
  const cargoCenter = await cargoService.getControlCenter();
  const shipments = cargoCenter.shipments || [];

  const nodes = [];
  const edges = [];
  const seenNodes = new Set();

  const pushNode = (node) => {
    if (seenNodes.has(node.id)) {
      return;
    }
    seenNodes.add(node.id);
    nodes.push(node);
  };

  for (const shipment of shipments) {
    const cargoNodeId = `cargo:${shipment.cargoId}`;
    pushNode({
      id: cargoNodeId,
      type: "CargoPiece",
      label: shipment.cargoId,
      riskLevel: shipment.riskLevel,
      integrityScore: shipment.integrityScore,
      custodyState: shipment.chainBroken ? "BROKEN" : "INTACT",
    });

    if (shipment.flight) {
      const flightNodeId = `flight:${shipment.flight}`;
      pushNode({
        id: flightNodeId,
        type: "Flight",
        label: shipment.flight,
      });
      edges.push({
        id: `${cargoNodeId}->${flightNodeId}`,
        type: "ASSIGNED_TO_FLIGHT",
        from: cargoNodeId,
        to: flightNodeId,
      });
    }

    if (shipment.currentLocation) {
      const locationNodeId = `location:${shipment.currentLocation}`;
      pushNode({
        id: locationNodeId,
        type: "Location",
        label: shipment.currentLocation,
      });
      edges.push({
        id: `${cargoNodeId}->${locationNodeId}`,
        type: "LOCATED_AT",
        from: cargoNodeId,
        to: locationNodeId,
      });
    }

    for (const actor of shipment.touchedBy || []) {
      const actorNodeId = `actor:${actor}`;
      pushNode({
        id: actorNodeId,
        type: "Stakeholder",
        label: actor,
      });
      edges.push({
        id: `${cargoNodeId}->${actorNodeId}`,
        type: "HANDLED_BY",
        from: cargoNodeId,
        to: actorNodeId,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      trackedCargo: cargoCenter.summary?.trackedCargo || shipments.length,
      graphNodes: nodes.length,
      graphEdges: edges.length,
      chainBrokenCargo: cargoCenter.summary?.chainBrokenCount || 0,
      stopLoadCargo: cargoCenter.summary?.stopLoadCount || 0,
    },
    shipments,
    nodes,
    edges,
  };
}

async function buildStakeholdersPayload({
  exposureRepository,
  operationsRepository,
  cargoService,
}) {
  const [alerts, pendingActions, cargoCenter] = await Promise.all([
    exposureRepository.getAlerts(100),
    operationsRepository.listPendingActions(100),
    cargoService.getControlCenter(),
  ]);

  const stakeholderMap = new Map();

  const ensureStakeholder = (name) => {
    if (!name) {
      return null;
    }
    if (!stakeholderMap.has(name)) {
      stakeholderMap.set(name, {
        id: slugify(name),
        name,
        activeTasks: 0,
        activeAlerts: 0,
        touchedCargoCount: 0,
        cargoIds: new Set(),
        lastActivityAt: null,
        roles: new Set(),
      });
    }
    return stakeholderMap.get(name);
  };

  for (const action of pendingActions) {
    const stakeholder = ensureStakeholder(action.assignedRole || action.team || "Unassigned");
    if (!stakeholder) continue;
    stakeholder.activeTasks += 1;
    stakeholder.roles.add("intervention-execution");
    stakeholder.lastActivityAt = maxTimestamp(stakeholder.lastActivityAt, action.createdAt);
  }

  for (const alert of alerts) {
    for (const target of alert.targetTeams || []) {
      const stakeholder = ensureStakeholder(target);
      if (!stakeholder) continue;
      stakeholder.activeAlerts += 1;
      stakeholder.roles.add("alert-subscriber");
      stakeholder.lastActivityAt = maxTimestamp(stakeholder.lastActivityAt, alert.occurred_at);
    }
  }

  for (const shipment of cargoCenter.shipments || []) {
    for (const actor of shipment.touchedBy || []) {
      const stakeholder = ensureStakeholder(actor);
      if (!stakeholder) continue;
      stakeholder.roles.add("cargo-custody");
      stakeholder.cargoIds.add(shipment.cargoId);
      stakeholder.touchedCargoCount = stakeholder.cargoIds.size;
      stakeholder.lastActivityAt = maxTimestamp(stakeholder.lastActivityAt, shipment.lastUpdatedAt);
    }

    const teamStakeholder = ensureStakeholder(shipment.currentTeam);
    if (teamStakeholder) {
      teamStakeholder.roles.add("current-owner");
      teamStakeholder.cargoIds.add(shipment.cargoId);
      teamStakeholder.touchedCargoCount = teamStakeholder.cargoIds.size;
      teamStakeholder.lastActivityAt = maxTimestamp(teamStakeholder.lastActivityAt, shipment.lastUpdatedAt);
    }
  }

  const stakeholders = Array.from(stakeholderMap.values())
    .map((stakeholder) => ({
      ...stakeholder,
      roles: Array.from(stakeholder.roles),
      cargoIds: Array.from(stakeholder.cargoIds),
    }))
    .sort((left, right) =>
      right.activeTasks - left.activeTasks
      || right.activeAlerts - left.activeAlerts
      || right.touchedCargoCount - left.touchedCargoCount,
    );

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      stakeholderCount: stakeholders.length,
      activeStakeholders: stakeholders.filter((item) => item.activeTasks > 0 || item.activeAlerts > 0).length,
      partiesWithCustody: stakeholders.filter((item) => item.touchedCargoCount > 0).length,
    },
    stakeholders,
  };
}

async function buildAiOpsPayload({
  analyticsService,
  cargoService,
  operationsRepository,
  exposureRepository,
}) {
  const [analytics, cargoCenter, pendingActions, alerts] = await Promise.all([
    analyticsService.getSummary(),
    cargoService.getControlCenter(),
    operationsRepository.listPendingActions(50),
    exposureRepository.getAlerts(25),
  ]);

  const [highestRisk] = [...(cargoCenter.highRisk || [])].sort((left, right) => right.riskScore - left.riskScore);

  return {
    generatedAt: new Date().toISOString(),
    context: {
      trackedCargo: cargoCenter.summary?.trackedCargo || 0,
      activeAlerts: alerts.length,
      pendingInterventions: pendingActions.length,
      chainBrokenCargo: cargoCenter.summary?.chainBrokenCount || 0,
      stopLoadCargo: cargoCenter.summary?.stopLoadCount || 0,
      totalUlds: analytics.totalUlds || 0,
      highestRiskCargo: highestRisk
        ? {
            cargoId: highestRisk.cargoId,
            riskScore: highestRisk.riskScore,
            location: highestRisk.currentLocation,
            status: highestRisk.currentStatus,
          }
        : null,
    },
    recommendedQuestions: [
      "Why is cargo risk increasing?",
      "What operational event caused the exposure?",
      "Show all cargo with broken custody chain.",
      "Which shipment has the highest theft risk?",
      "Replay movement timeline.",
    ],
  };
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function maxTimestamp(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}
