import { createHash } from "crypto";

const CARGO_EVENTS = [
  "CargoReceived",
  "CargoUnloaded",
  "CargoScannedOut",
  "CargoTransferred",
  "CargoInspected",
  "CargoHeld",
  "CargoOpened",
  "CargoRepacked",
  "CargoReleased",
  "CargoScannedIn",
  "CargoReloaded",
  "CargoMissing",
  "CargoDamaged",
  "CargoTamperAlert",
  "CustodyViolation",
];

export class CargoService {
  constructor({
    config,
    cargoRepository,
    exposureRepository,
    actionOrchestrator,
    notificationRouter,
    auditStore,
    io,
    logger,
  }) {
    this.config = config;
    this.cargoRepository = cargoRepository;
    this.exposureRepository = exposureRepository;
    this.actionOrchestrator = actionOrchestrator;
    this.notificationRouter = notificationRouter;
    this.auditStore = auditStore;
    this.io = io;
    this.logger = logger;
    this.seeded = false;
  }

  async ensureSeedData() {
    if (this.seeded) {
      return;
    }

    const existing = await this.cargoRepository.listCargo(5);
    if (existing.length > 0) {
      this.seeded = true;
      return;
    }

    if (!this.config.cargo.seedDemo) {
      this.seeded = true;
      return;
    }

    this.seeded = true;
    const seededEvents = buildSeedEvents();
    for (const event of seededEvents) {
      await this.recordEvent(event, { emit: false, auditType: "cargo-seed" });
    }
  }

  async getControlCenter() {
    await this.ensureSeedData();
    const shipments = await this.cargoRepository.listCargo(250);
    const highRisk = shipments
      .filter((item) => item.riskLevel !== "LOW")
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 10);

    return {
      summary: {
        trackedCargo: shipments.length,
        chainBrokenCount: shipments.filter((item) => item.chainBroken).length,
        stopLoadCount: shipments.filter((item) => item.stopLoad).length,
        missingCount: shipments.filter((item) => item.currentStatus === "MISSING").length,
        tamperCount: shipments.filter((item) => item.currentStatus === "TAMPER_ALERT").length,
      },
      shipments,
      highRisk,
    };
  }

  async scanOut(payload) {
    return this.recordEvent({
      ...payload,
      action: "CargoScannedOut",
      reason: payload.reason || "Operational Transfer",
    });
  }

  async scanIn(payload) {
    return this.recordEvent({
      ...payload,
      action: "CargoScannedIn",
      reason: payload.reason || "Returned To Custody",
    });
  }

  async verify(payload) {
    const previous = await this.cargoRepository.getState(payload.cargo_id);
    const inferredAction = payload.action
      || (payload.verification?.workflowMatch === false ? "CustodyViolation" : "CargoTransferred");

    return this.recordEvent({
      ...payload,
      action: inferredAction,
      reason: payload.reason || "Custody Verification",
      flight: payload.flight || previous?.flight || "EK202",
    });
  }

  async reload(payload) {
    const previous = await this.cargoRepository.getState(payload.cargo_id);
    const verification = buildVerification(payload, previous);
    const integrityScore = computeIntegrityScore({
      previous,
      payload,
      verification,
    });

    const shouldStopLoad = integrityScore < 70
      || !verification.awbMatch
      || !verification.sealMatch
      || !verification.destinationMatch;

    return this.recordEvent({
      ...payload,
      action: shouldStopLoad ? "CustodyViolation" : "CargoReloaded",
      reason: shouldStopLoad ? "Reload Validation Failed" : (payload.reason || "Reload Cleared"),
      integrity_override_required: shouldStopLoad,
      verification: {
        ...verification,
        cargoIntegrityScore: integrityScore,
        supervisorOverrideRequired: shouldStopLoad,
      },
      flight: payload.flight || previous?.flight || "EK202",
    });
  }

  async getHistory(cargoId) {
    await this.ensureSeedData();
    const history = await this.cargoRepository.getHistory(cargoId, 300);
    return history.reverse();
  }

  async getLocation(cargoId) {
    await this.ensureSeedData();
    const state = await this.cargoRepository.getState(cargoId);
    const history = await this.getHistory(cargoId);
    if (!state) return null;

    return {
      cargoId,
      currentLocation: state.currentLocation,
      currentZone: state.currentZone,
      currentCustodian: state.currentCustodian,
      vehicleTransfer: state.currentCarrier,
      lastUpdatedAt: state.lastUpdatedAt,
      movementReplay: history.map((event) => ({
        timestamp: event.timestamp,
        location: event.location,
        zone: event.zone,
        action: event.action,
      })),
    };
  }

  async getRisk(cargoId) {
    await this.ensureSeedData();
    const state = await this.cargoRepository.getState(cargoId);
    if (!state) return null;

    return {
      cargoId,
      riskScore: state.riskScore,
      riskLevel: state.riskLevel,
      incidentSeverity: state.incidentSeverity,
      theftRisk: state.theftRisk,
      tamperRisk: state.tamperRisk,
      chainBroken: state.chainBroken,
      stopLoad: state.stopLoad,
      recommendedIntervention: state.recommendedIntervention,
      riskFactors: state.riskFactors,
      cargoIntegrityScore: state.integrityScore,
    };
  }

  async getVideo(cargoId) {
    await this.ensureSeedData();
    const evidence = await this.cargoRepository.getEvidence(cargoId, 100);
    if (evidence.length > 0) {
      return {
        cargoId,
        evidence: evidence.map((item) => ({
          eventId: item.eventId,
          timestamp: item.recordedAt,
          location: item.location,
          action: item.action,
          replayAvailable: true,
          replayUrl: `/api/cargo/video/${cargoId}/${item.eventId}/replay`,
          condition: item.condition,
          sealId: item.sealId,
          anomalies: item.metadata?.replay?.anomalies || [],
        })),
      };
    }

    const history = await this.getHistory(cargoId);
    return {
      cargoId,
      evidence: history
        .filter((event) => event.video_clip || event.photo_evidence)
        .map((event) => ({
          eventId: event.id,
          timestamp: event.timestamp,
          location: event.location,
          action: event.action,
          replayAvailable: true,
          replayUrl: `/api/cargo/video/${cargoId}/${event.id}/replay`,
          condition: event.condition,
          sealId: event.seal_id,
          anomalies: event.visionFindings ? buildReplayFromEvent(event).anomalies : [],
        })),
    };
  }

  async getReplay(cargoId, eventId) {
    await this.ensureSeedData();
    const evidence = await this.cargoRepository.getEvidenceEvent(cargoId, eventId);
    if (evidence) {
      return buildReplayResponse(cargoId, eventId, evidence);
    }

    const history = await this.cargoRepository.getHistory(cargoId, 300);
    const event = history.find((item) => item.id === eventId);
    if (!event) {
      return null;
    }
    return buildReplayResponse(cargoId, eventId, {
      eventId,
      recordedAt: event.timestamp,
      location: event.location,
      action: event.action,
      condition: event.condition,
      sealId: event.seal_id,
      metadata: {
        replay: buildReplayFromEvent(event),
        visionFindings: event.visionFindings || {},
      },
    });
  }

  async getReplayFrame(cargoId, eventId, frameIndex) {
    const replay = await this.getReplay(cargoId, eventId);
    if (!replay) {
      return null;
    }

    const safeIndex = Math.max(0, Math.min(frameIndex, replay.keyframes.length - 1));
    const frame = replay.keyframes[safeIndex];
    const activeAnomaly = replay.anomalies
      .slice()
      .sort((a, b) => Math.abs(a.atSecond - frame.atSecond) - Math.abs(b.atSecond - frame.atSecond))[0];

    return buildReplayFrameSvg({
      cargoId,
      eventId,
      frame,
      action: replay.action,
      location: replay.location,
      anomaly: activeAnomaly,
      condition: replay.condition,
      sealId: replay.sealId,
    });
  }

  async getChainOfCustody(cargoId) {
    await this.ensureSeedData();
    const state = await this.cargoRepository.getState(cargoId);
    const history = await this.getHistory(cargoId);
    if (!state) return null;

    return {
      cargoId,
      flight: state.flight,
      currentLocation: state.currentLocation,
      currentStatus: state.currentStatus,
      currentCustodian: state.currentCustodian,
      currentTeam: state.currentTeam,
      removedReason: state.removedReason,
      outsideCustodyMinutes: state.outsideCustodyMinutes,
      returnedToManifest: state.returnedToManifest,
      chainBroken: state.chainBroken,
      cargoIntegrityScore: state.integrityScore,
      stopLoad: state.stopLoad,
      touchedBy: state.touchedBy,
      manifestVerified: state.manifestVerified,
      evidenceTrail: history
        .filter((event) => event.video_clip || event.photo_evidence)
        .map((event) => ({
          timestamp: event.timestamp,
          action: event.action,
          video: event.video_clip || null,
          photo: event.photo_evidence || null,
        })),
      timeline: history.map((event) => ({
        id: event.id,
        action: event.action,
        timestamp: event.timestamp,
        location: event.location,
        handler: event.handler,
        team: event.team,
        durationOutsideCustodyMinutes: event.state_snapshot?.outsideCustodyMinutes ?? 0,
        condition: event.condition,
        sealId: event.seal_id,
        riskScore: event.risk?.riskScore ?? 0,
        integrityScore: event.integrity?.cargoIntegrityScore ?? 100,
        video: event.video_clip || null,
      })),
    };
  }

  async queryCopilot(prompt) {
    await this.ensureSeedData();
    const shipments = await this.cargoRepository.listCargo(250);
    const normalized = String(prompt || "").toLowerCase();

    if (normalized.includes("broken custody chain")) {
      const broken = shipments.filter((item) => item.chainBroken);
      return {
        answer: broken.length === 0
          ? "No shipments currently show a broken chain of custody."
          : `Broken custody chain detected for ${broken.map((item) => item.cargoId).join(", ")}.`,
        matches: broken.map((item) => item.cargoId),
      };
    }

    if (normalized.includes("highest theft risk")) {
      const [top] = [...shipments].sort((a, b) => b.theftRisk - a.theftRisk);
      return {
        answer: top
          ? `${top.cargoId} has the highest theft risk at ${Math.round(top.theftRisk)} with status ${top.currentStatus} in ${top.currentLocation}.`
          : "No tracked shipments available.",
        matches: top ? [top.cargoId] : [],
      };
    }

    const cargoId = extractCargoId(prompt);
    if (cargoId) {
      const state = await this.cargoRepository.getState(cargoId);
      if (!state) {
        return {
          answer: `No cargo record found for ${cargoId}.`,
          matches: [],
        };
      }

      const history = await this.getHistory(cargoId);
      const latestRemoval = [...history].reverse().find((event) => event.action === "CargoScannedOut");
      return {
        answer: `${cargoId} is currently at ${state.currentLocation} under ${state.currentCustodian}. It was removed because "${latestRemoval?.reason || state.removedReason || "operational handling"}" and has spent ${state.outsideCustodyMinutes} minutes outside primary custody.`,
        matches: [cargoId],
      };
    }

    return {
      answer: "CargoOps Agent is ready. Ask about a specific AWB, broken custody chains, highest theft risk, or movement replay.",
      matches: [],
    };
  }

  async recordEvent(payload, options = {}) {
    await this.ensureSeedData();
    validateEventPayload(payload);

    const previousState = await this.cargoRepository.getState(payload.cargo_id);
    const previousEvent = await this.cargoRepository.getLatestEvent(payload.cargo_id);
    const verification = buildVerification(payload, previousState);
    const visionFindings = buildVisionFindings(payload);
    const risk = computeRisk({
      payload,
      previousState,
      verification,
      visionFindings,
    });
    const integrityScore = payload.verification?.cargoIntegrityScore
      ?? computeIntegrityScore({ previous: previousState, payload, verification });

    const event = {
      id: `${payload.cargo_id}-${Date.now()}-${Math.round(Math.random() * 10000)}`,
      cargo_id: payload.cargo_id,
      flight: payload.flight || previousState?.flight || "EK202",
      timestamp: payload.timestamp || new Date().toISOString(),
      location: payload.location,
      zone: payload.zone || inferZoneFromLocation(payload.location),
      handler: payload.handler || "unassigned-operator",
      team: payload.team || "cargo_ops",
      action: payload.action,
      reason: payload.reason || "Operational Handling",
      condition: payload.condition || previousState?.condition || "sealed",
      seal_id: payload.seal_id || previousState?.sealId || "UNKNOWN",
      weight: payload.weight || previousState?.weightKg || "0kg",
      temperature: payload.temperature || previousState?.temperatureC || "4C",
      photo_evidence: payload.photo_evidence || null,
      video_clip: payload.video_clip || null,
      signature: payload.signature || `digital:${payload.handler || "system"}`,
      barcode_scan: payload.barcode_scan || null,
      rfid_scan: payload.rfid_scan || null,
      biometric_verified: Boolean(payload.biometric_verified),
      nfc_seal: payload.nfc_seal || null,
      verification,
      visionFindings,
      risk,
      integrity: {
        cargoIntegrityScore: integrityScore,
        supervisorOverrideRequired: integrityScore < 70 || risk.chainBroken,
      },
      previous_hash: previousEvent?.hash || "GENESIS",
    };

    event.hash = createHash("sha256")
      .update(JSON.stringify({
        cargo_id: event.cargo_id,
        timestamp: event.timestamp,
        action: event.action,
        location: event.location,
        handler: event.handler,
        previous_hash: event.previous_hash,
      }))
      .digest("hex");

    const nextState = buildState({
      previous: previousState,
      event,
      integrityScore,
      risk,
    });
    event.state_snapshot = nextState;

    await this.cargoRepository.appendEvent(payload.cargo_id, event);
    await this.cargoRepository.saveState(payload.cargo_id, nextState);
    await this.auditStore.log(options.auditType || "cargo-custody-event", event);

    if (options.emit !== false) {
      this.io.emit("cargo-event", {
        cargoId: payload.cargo_id,
        event,
        state: nextState,
      });
    }

    if (risk.chainBroken || risk.incidentSeverity === "CRITICAL") {
      const incident = {
        id: `incident-${payload.cargo_id}-${Date.now()}`,
        cargoId: payload.cargo_id,
        uldId: payload.cargo_id,
        severity: risk.incidentSeverity,
        riskScore: risk.riskScore,
        message: risk.recommendedIntervention,
        location: event.location,
        timestamp: event.timestamp,
        stopLoad: nextState.stopLoad,
        chainBroken: nextState.chainBroken,
      };
      const alert = {
        id: `${payload.cargo_id}-${risk.incidentSeverity}-${Date.now()}`,
        uld_id: payload.cargo_id,
        status: risk.incidentSeverity,
        temperature: event.temperature,
        exposure_used: nextState.outsideCustodyMinutes,
        occurred_at: event.timestamp,
        message: risk.recommendedIntervention,
        airport_code: event.zone,
        source: "CARGO_CUSTODY",
      };
      await this.exposureRepository.appendAlert(alert);
      await this.actionOrchestrator.orchestrateCargoIncident({ cargoId: payload.cargo_id, incident });
      await this.notificationRouter.publishNotifications(
        [
          {
            level: risk.incidentSeverity,
            channel: "webhook",
            message: risk.recommendedIntervention,
          },
        ],
        {
          uldId: payload.cargo_id,
          temperature: event.temperature,
          exposureUsed: nextState.outsideCustodyMinutes,
          occurredAt: event.timestamp,
          airportCode: event.zone,
        },
      );
      await this.auditStore.log("cargo-custody-incident", incident);
      if (options.emit !== false) {
        this.io.emit("alert", alert);
        this.io.emit("cargo-incident", incident);
      }
    }

    return {
      event,
      state: nextState,
      stopLoad: nextState.stopLoad,
    };
  }
}

function validateEventPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Cargo event payload is required");
  }
  if (!payload.cargo_id) {
    throw new Error("cargo_id is required");
  }
  if (!payload.location) {
    throw new Error("location is required");
  }
  if (!payload.action || !CARGO_EVENTS.includes(payload.action)) {
    throw new Error("action must be a supported cargo lifecycle event");
  }
}

function buildVerification(payload, previousState) {
  const normalizedWeight = parseWeight(payload.weight || previousState?.weightKg || "0kg");
  const previousWeight = parseWeight(previousState?.weightKg || payload.weight || "0kg");
  const weightDelta = Math.abs(normalizedWeight - previousWeight);

  return {
    barcodeVerified: Boolean(payload.barcode_scan),
    rfidVerified: Boolean(payload.rfid_scan),
    biometricVerified: Boolean(payload.biometric_verified),
    awbMatch: payload.awb_match !== false,
    weightMatch: payload.weight_match !== false && weightDelta <= 8,
    sealMatch: payload.seal_match !== false && (!previousState?.sealId || payload.seal_id === previousState.sealId),
    destinationMatch: payload.destination_match !== false,
    workflowMatch: payload.workflow_match !== false,
    secureLoginVerified: payload.secure_login !== false,
    weightDeltaKg: Number(weightDelta.toFixed(1)),
  };
}

function buildVisionFindings(payload) {
  const findings = payload.vision_findings || {};
  return {
    cargoRemoved: Boolean(findings.cargoRemoved || payload.action === "CargoUnloaded"),
    cargoOpened: Boolean(findings.cargoOpened || payload.action === "CargoOpened"),
    cargoSwapped: Boolean(findings.cargoSwapped),
    leftUnattended: Boolean(findings.leftUnattended),
    forkliftPickup: Boolean(findings.forkliftPickup),
    wrongPalletMoved: Boolean(findings.wrongPalletMoved),
    unauthorizedAccess: Boolean(findings.unauthorizedAccess),
    brokenSeal: Boolean(findings.brokenSeal || payload.condition === "broken-seal"),
    packageDamage: Boolean(findings.packageDamage || payload.action === "CargoDamaged"),
    heatSignatureAnomaly: Boolean(findings.heatSignatureAnomaly),
    longIdleCargo: Boolean(findings.longIdleCargo),
  };
}

function computeRisk({ payload, previousState, verification, visionFindings }) {
  let score = 12;
  const factors = [];

  if (!verification.barcodeVerified || !verification.rfidVerified || !verification.biometricVerified) {
    score += 18;
    factors.push("dual_verification_incomplete");
  }
  if (!verification.awbMatch) {
    score += 20;
    factors.push("awb_mismatch");
  }
  if (!verification.weightMatch) {
    score += 14;
    factors.push("weight_mismatch");
  }
  if (!verification.sealMatch) {
    score += 16;
    factors.push("seal_mismatch");
  }
  if (!verification.destinationMatch) {
    score += 12;
    factors.push("destination_mismatch");
  }
  if (!verification.workflowMatch) {
    score += 12;
    factors.push("workflow_mismatch");
  }
  if (visionFindings.cargoSwapped || visionFindings.unauthorizedAccess) {
    score += 20;
    factors.push("swap_or_unauthorized_access");
  }
  if (visionFindings.brokenSeal || payload.action === "CargoTamperAlert") {
    score += 18;
    factors.push("tamper_or_broken_seal");
  }
  if (visionFindings.packageDamage || payload.action === "CargoDamaged") {
    score += 12;
    factors.push("package_damage");
  }
  if (payload.action === "CargoMissing") {
    score += 25;
    factors.push("cargo_missing");
  }
  if (payload.action === "CustodyViolation") {
    score += 22;
    factors.push("custody_violation");
  }

  const outsideCustodyMinutes = computeOutsideCustodyMinutes(previousState, payload);
  if (outsideCustodyMinutes > 45) {
    score += 10;
    factors.push("extended_outside_custody");
  }

  const chainBroken = factors.some((factor) =>
    ["awb_mismatch", "seal_mismatch", "cargo_missing", "custody_violation", "swap_or_unauthorized_access"].includes(factor),
  );
  const riskScore = Math.min(100, score);
  const riskLevel = riskScore >= 75 ? "HIGH" : riskScore >= 45 ? "MEDIUM" : "LOW";
  const incidentSeverity = riskScore >= 85 ? "CRITICAL" : riskScore >= 65 ? "HIGH" : riskScore >= 40 ? "MEDIUM" : "LOW";

  return {
    riskScore,
    riskLevel,
    incidentSeverity,
    chainBroken,
    theftRisk: Math.min(100, riskScore + (payload.action === "CargoMissing" ? 15 : 0)),
    tamperRisk: Math.min(100, riskScore + (visionFindings.brokenSeal ? 10 : 0)),
    outsideCustodyMinutes,
    riskFactors: factors,
    recommendedIntervention:
      chainBroken || riskScore >= 75
        ? "STOP LOAD, dispatch supervisor review, validate seal/evidence, and hold shipment for forensic reconciliation."
        : riskScore >= 45
          ? "Escalate to cargo supervisor, verify manifest match, and complete scan-in before transfer continues."
          : "Continue monitored handling with chain-of-custody logging active.",
  };
}

function computeIntegrityScore({ previous, payload, verification }) {
  let score = 100;

  if (!verification.awbMatch) score -= 25;
  if (!verification.weightMatch) score -= 14;
  if (!verification.sealMatch) score -= 18;
  if (!verification.destinationMatch) score -= 12;
  if (!verification.workflowMatch) score -= 10;
  if (!verification.barcodeVerified || !verification.rfidVerified || !verification.biometricVerified) score -= 15;
  if (payload.action === "CargoDamaged") score -= 16;
  if (payload.action === "CargoTamperAlert") score -= 22;
  if (previous?.chainBroken) score -= 8;

  return Math.max(0, score);
}

function buildState({ previous, event, integrityScore, risk }) {
  const outsideCustodySince = resolveOutsideCustodySince(previous, event);
  const outsideCustodyMinutes = computeDurationMinutes(outsideCustodySince, event.timestamp);
  const currentStatus = normalizeCargoStatus(event.action);
  const touchedBy = dedupe([...(previous?.touchedBy || []), event.handler]);
  const manifestVerified = event.action === "CargoReloaded" && integrityScore >= 70 && !risk.chainBroken;
  const returnedToManifest = event.action === "CargoReloaded" || previous?.returnedToManifest || false;

  return {
    cargoId: event.cargo_id,
    flight: event.flight,
    currentLocation: event.location,
    currentZone: event.zone,
    currentCustodian: event.handler,
    currentTeam: event.team,
    currentCarrier: event.current_carrier || inferCarrier(event.location),
    removedReason: event.reason,
    condition: event.condition,
    sealId: event.seal_id,
    weightKg: event.weight,
    temperatureC: event.temperature,
    currentStatus,
    outsideCustodySince,
    outsideCustodyMinutes,
    returnedToManifest,
    manifestVerified,
    chainBroken: risk.chainBroken,
    integrityScore,
    stopLoad: integrityScore < 70 || risk.chainBroken,
    riskScore: risk.riskScore,
    riskLevel: risk.riskLevel,
    incidentSeverity: risk.incidentSeverity,
    theftRisk: risk.theftRisk,
    tamperRisk: risk.tamperRisk,
    recommendedIntervention: risk.recommendedIntervention,
    riskFactors: risk.riskFactors,
    lastAction: event.action,
    lastUpdatedAt: event.timestamp,
    touchedBy,
  };
}

function normalizeCargoStatus(action) {
  if (action === "CargoMissing") return "MISSING";
  if (action === "CargoTamperAlert") return "TAMPER_ALERT";
  if (action === "CargoDamaged") return "DAMAGED";
  if (action === "CustodyViolation") return "CUSTODY_VIOLATION";
  if (action === "CargoReloaded") return "RELOADED";
  if (action === "CargoScannedIn") return "IN_CUSTODY";
  if (action === "CargoScannedOut" || action === "CargoTransferred" || action === "CargoHeld") return "OUT_OF_CUSTODY";
  return "TRACKED";
}

function resolveOutsideCustodySince(previous, event) {
  if (["CargoScannedOut", "CargoTransferred", "CargoHeld", "CargoUnloaded"].includes(event.action)) {
    return event.timestamp;
  }
  if (["CargoScannedIn", "CargoReleased", "CargoReloaded"].includes(event.action)) {
    return null;
  }
  return previous?.outsideCustodySince || null;
}

function computeOutsideCustodyMinutes(previousState, payload) {
  const outsideCustodySince = resolveOutsideCustodySince(previousState, {
    action: payload.action,
    timestamp: payload.timestamp || new Date().toISOString(),
  });
  return computeDurationMinutes(outsideCustodySince, payload.timestamp || new Date().toISOString());
}

function computeDurationMinutes(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}

function inferZoneFromLocation(location) {
  const normalized = String(location || "").toLowerCase();
  if (normalized.includes("cold")) return "Cold Room";
  if (normalized.includes("bond")) return "Bonded Storage";
  if (normalized.includes("custom")) return "Customs Hold";
  if (normalized.includes("truck")) return "Truck Dock";
  if (normalized.includes("apron")) return "Apron";
  if (normalized.includes("warehouse")) return "Warehouse";
  return "ULD Staging";
}

function inferCarrier(location) {
  const normalized = String(location || "").toLowerCase();
  if (normalized.includes("truck")) return "Transfer Carrier";
  if (normalized.includes("aircraft")) return "Aircraft";
  return "Ground Handling";
}

function parseWeight(value) {
  return Number.parseFloat(String(value || "0").replace(/[^\d.]/g, "")) || 0;
}

function dedupe(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractCargoId(prompt) {
  const match = String(prompt || "").match(/[A-Z]{3}-\d{4,}/i);
  return match ? match[0].toUpperCase() : null;
}

function buildSeedEvents() {
  return [
    {
      cargo_id: "AWB-78492",
      flight: "EK202",
      timestamp: "2026-04-25T08:00:00.000Z",
      location: "Aircraft Hold / Position 14",
      handler: "gh-214",
      team: "ground_handlers",
      action: "CargoUnloaded",
      reason: "Temperature-controlled transfer",
      condition: "sealed",
      seal_id: "SEAL-9923",
      weight: "425kg",
      temperature: "4C",
      photo_evidence: "https://evidence.aerosentinel.local/awb-78492/unloaded.jpg",
      video_clip: "https://evidence.aerosentinel.local/awb-78492/unloaded.mp4",
      signature: "digital:gh-214",
      barcode_scan: "AWB-78492",
      rfid_scan: "RFID-78492",
      biometric_verified: true,
    },
    {
      cargo_id: "AWB-78492",
      flight: "EK202",
      timestamp: "2026-04-25T08:14:00.000Z",
      location: "Customs Hold / Bay 4",
      handler: "co-118",
      team: "customs",
      action: "CargoScannedOut",
      reason: "Customs Inspection",
      condition: "sealed",
      seal_id: "SEAL-9923",
      weight: "425kg",
      temperature: "5C",
      photo_evidence: "https://evidence.aerosentinel.local/awb-78492/scanout.jpg",
      video_clip: "https://evidence.aerosentinel.local/awb-78492/scanout.mp4",
      signature: "digital:co-118",
      barcode_scan: "AWB-78492",
      rfid_scan: "RFID-78492",
      biometric_verified: true,
    },
    {
      cargo_id: "AWB-78492",
      flight: "EK202",
      timestamp: "2026-04-25T09:02:00.000Z",
      location: "Warehouse B / Repack Cell 2",
      handler: "cg-332",
      team: "cargo_ops",
      action: "CargoRepacked",
      reason: "Label Correction",
      condition: "resealed",
      seal_id: "SEAL-10024",
      weight: "424kg",
      temperature: "4C",
      photo_evidence: "https://evidence.aerosentinel.local/awb-78492/repacked.jpg",
      video_clip: "https://evidence.aerosentinel.local/awb-78492/repacked.mp4",
      signature: "digital:cg-332",
      barcode_scan: "AWB-78492",
      rfid_scan: "RFID-78492",
      biometric_verified: true,
    },
    {
      cargo_id: "AWB-78492",
      flight: "EK202",
      timestamp: "2026-04-25T09:30:00.000Z",
      location: "ULD Staging / Lane 7",
      handler: "cg-332",
      team: "cargo_ops",
      action: "CargoScannedIn",
      reason: "Returned From Inspection",
      condition: "resealed",
      seal_id: "SEAL-10024",
      weight: "424kg",
      temperature: "4C",
      photo_evidence: "https://evidence.aerosentinel.local/awb-78492/return.jpg",
      video_clip: "https://evidence.aerosentinel.local/awb-78492/return.mp4",
      signature: "digital:cg-332",
      barcode_scan: "AWB-78492",
      rfid_scan: "RFID-78492",
      biometric_verified: true,
    },
    {
      cargo_id: "AWB-55110",
      flight: "EK202",
      timestamp: "2026-04-25T08:22:00.000Z",
      location: "Warehouse B / Bay 9",
      handler: "sec-901",
      team: "security",
      action: "CargoHeld",
      reason: "Security Hold",
      condition: "sealed",
      seal_id: "SEAL-4410",
      weight: "318kg",
      temperature: "6C",
      photo_evidence: "https://evidence.aerosentinel.local/awb-55110/held.jpg",
      video_clip: "https://evidence.aerosentinel.local/awb-55110/held.mp4",
      signature: "digital:sec-901",
      barcode_scan: "AWB-55110",
      rfid_scan: "RFID-55110",
      biometric_verified: true,
    },
    {
      cargo_id: "AWB-55110",
      flight: "EK202",
      timestamp: "2026-04-25T09:18:00.000Z",
      location: "Warehouse B / Bay 9",
      handler: "sec-901",
      team: "security",
      action: "CargoTamperAlert",
      reason: "Broken seal detected by camera",
      condition: "broken-seal",
      seal_id: "SEAL-4410",
      weight: "314kg",
      temperature: "8C",
      photo_evidence: "https://evidence.aerosentinel.local/awb-55110/tamper.jpg",
      video_clip: "https://evidence.aerosentinel.local/awb-55110/tamper.mp4",
      signature: "digital:sec-901",
      barcode_scan: "AWB-55110",
      rfid_scan: "RFID-55110",
      biometric_verified: false,
      vision_findings: {
        brokenSeal: true,
        unauthorizedAccess: true,
        cargoOpened: true,
      },
    },
    {
      cargo_id: "AWB-11204",
      flight: "EK202",
      timestamp: "2026-04-25T10:06:00.000Z",
      location: "Apron / Truck Dock 3",
      handler: "tr-404",
      team: "transfer_ops",
      action: "CargoMissing",
      reason: "Object moved without scan confirmation",
      condition: "unknown",
      seal_id: "SEAL-7100",
      weight: "210kg",
      temperature: "7C",
      photo_evidence: "https://evidence.aerosentinel.local/awb-11204/missing.jpg",
      video_clip: "https://evidence.aerosentinel.local/awb-11204/missing.mp4",
      signature: "digital:tr-404",
      barcode_scan: null,
      rfid_scan: null,
      biometric_verified: false,
      vision_findings: {
        leftUnattended: true,
        wrongPalletMoved: true,
      },
    },
  ];
}

function buildReplayResponse(cargoId, eventId, evidence) {
  const replay = evidence.metadata?.replay || {
    durationSeconds: 90,
    anomalies: [{ atSecond: 30, label: "Custody checkpoint", severity: "LOW" }],
    keyframes: [0, 15, 30, 45, 60, 75].map((atSecond, index) => ({
      index,
      atSecond,
      caption: `Replay frame ${index + 1}`,
    })),
  };

  return {
    cargoId,
    eventId,
    timestamp: evidence.recordedAt,
    location: evidence.location,
    action: evidence.action,
    condition: evidence.condition,
    sealId: evidence.sealId,
    durationSeconds: replay.durationSeconds,
    anomalies: replay.anomalies,
    keyframes: replay.keyframes.map((frame) => ({
      ...frame,
      frameUrl: `/api/cargo/video/${cargoId}/${eventId}/frame/${frame.index}`,
    })),
  };
}

function buildReplayFromEvent(event) {
  const anomalies = [];
  const findings = event.visionFindings || {};
  if (findings.brokenSeal) anomalies.push({ atSecond: 18, label: "Broken seal detected", severity: "HIGH" });
  if (findings.unauthorizedAccess) anomalies.push({ atSecond: 24, label: "Unauthorized access", severity: "CRITICAL" });
  if (findings.cargoSwapped) anomalies.push({ atSecond: 36, label: "Possible cargo swap", severity: "CRITICAL" });
  if (findings.leftUnattended) anomalies.push({ atSecond: 42, label: "Cargo left unattended", severity: "HIGH" });
  if (findings.packageDamage) anomalies.push({ atSecond: 58, label: "Damage signature", severity: "HIGH" });
  if (findings.heatSignatureAnomaly) anomalies.push({ atSecond: 63, label: "Heat anomaly", severity: "MEDIUM" });
  if (anomalies.length === 0) {
    anomalies.push({ atSecond: 30, label: "Custody checkpoint", severity: "LOW" });
  }

  return {
    durationSeconds: 90,
    anomalies,
    keyframes: [0, 15, 30, 45, 60, 75].map((atSecond, index) => ({
      index,
      atSecond,
      caption: `${event.action} frame ${index + 1}`,
    })),
  };
}

function buildReplayFrameSvg({ cargoId, eventId, frame, action, location, anomaly, condition, sealId }) {
  const severityColor =
    anomaly?.severity === "CRITICAL" ? "#ef4444" :
    anomaly?.severity === "HIGH" ? "#f97316" :
    anomaly?.severity === "MEDIUM" ? "#f59e0b" :
    "#22c55e";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect x="72" y="72" width="1136" height="576" rx="28" fill="#111827" stroke="#334155" stroke-width="2"/>
  <rect x="110" y="118" width="1060" height="400" rx="20" fill="#1f2937"/>
  <rect x="110" y="540" width="1060" height="60" rx="12" fill="#0f172a" stroke="#334155"/>
  <circle cx="${180 + (frame.atSecond / 90) * 900}" cy="570" r="12" fill="${severityColor}"/>
  <text x="140" y="170" fill="#e2e8f0" font-family="Arial, sans-serif" font-size="34" font-weight="700">${escapeXml(cargoId)} · ${escapeXml(action)}</text>
  <text x="140" y="212" fill="#94a3b8" font-family="Arial, sans-serif" font-size="20">Replay Event ${escapeXml(eventId)} · ${escapeXml(location)}</text>
  <text x="140" y="270" fill="#f8fafc" font-family="Arial, sans-serif" font-size="28">Frame ${frame.index + 1} at ${frame.atSecond}s</text>
  <text x="140" y="314" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="22">${escapeXml(frame.caption)}</text>
  <text x="140" y="388" fill="${severityColor}" font-family="Arial, sans-serif" font-size="30" font-weight="700">${escapeXml(anomaly?.label || "No anomaly in frame")}</text>
  <text x="140" y="430" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="20">Condition: ${escapeXml(condition || "sealed")} · Seal: ${escapeXml(sealId || "n/a")}</text>
  <text x="140" y="580" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="18">Playback scrubber</text>
  <text x="1010" y="580" fill="#94a3b8" font-family="Arial, sans-serif" font-size="18">${frame.atSecond}s / 90s</text>
  <rect x="940" y="120" width="180" height="120" rx="18" fill="${severityColor}" opacity="0.18"/>
  <text x="965" y="170" fill="${severityColor}" font-family="Arial, sans-serif" font-size="22" font-weight="700">${escapeXml(anomaly?.severity || "LOW")}</text>
  <text x="965" y="204" fill="#f8fafc" font-family="Arial, sans-serif" font-size="18">AI camera replay</text>
</svg>`;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
