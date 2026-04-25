import axios from "axios";
import { referenceShipment } from "../data/referenceShipment.js";

export class OneRecordService {
  constructor({ config, logger, authService, redis }) {
    this.config = config;
    this.logger = logger;
    this.authService = authService;
    this.redis = redis;
  }

  twinKey(uldId) {
    return `one-record:twin:${uldId}`;
  }

  async getUld(uldId) {
    const cached = await this.redis.get(this.twinKey(uldId));
    const cachedTwin = cached ? JSON.parse(cached) : null;

    if (!this.config.oneRecord.enabled) {
      return cachedTwin;
    }

    try {
      const response = await axios.get(this.uldUrl(uldId), {
        headers: await this.headers(),
        timeout: 5000,
      });
      const normalized = normalizeTwin(response.data);
      await this.redis.set(this.twinKey(uldId), JSON.stringify(normalized));
      return normalized;
    } catch (error) {
      this.logger.warn({ error: error.message, uldId }, "ONE Record fetch failed");
      return cachedTwin;
    }
  }

  async createUld(payload) {
    return this.write("post", this.baseCollectionUrl(), payload);
  }

  async updateUld(uldId, payload) {
    return this.write("patch", this.uldUrl(uldId), payload);
  }

  async upsertTwin({ reading, status, risk, actions = [], workflows = [], context, flight }) {
    const payload = buildTwinPayload({
      baseUrl: this.config.oneRecord.baseUrl,
      reading,
      status,
      risk,
      actions,
      workflows,
      context,
      flight,
    });

    const result = await this.updateUld(reading.uld_id, payload);
    const normalized = {
      payload,
      operationalState: status,
      lastSyncedAt: new Date().toISOString(),
      syncStatus: result ? "SYNCED" : "DEGRADED",
    };
    await this.redis.set(this.twinKey(reading.uld_id), JSON.stringify(normalized));
    return normalized;
  }

  async getReferenceShipment() {
    return referenceShipment;
  }

  async listShipments({ limit = 20 } = {}) {
    if (!this.config.oneRecord.enabled) {
      return [referenceShipment].slice(0, limit);
    }

    try {
      const response = await axios.get(this.shipmentsCollectionUrl(), {
        headers: await this.headers(),
        timeout: 8000,
      });
      const shipments = normalizeShipmentCollection(response.data).slice(0, limit);
      return Promise.all(
        shipments.map((shipment) =>
          this.expandShipmentGraph(shipment, { depth: this.config.oneRecord.maxTraversalDepth }),
        ),
      );
    } catch (error) {
      this.logger.warn({ error: error.message }, "ONE Record shipment list failed");
      return [referenceShipment].slice(0, limit);
    }
  }

  async getShipment(shipmentId) {
    if (!this.config.oneRecord.enabled) {
      return referenceShipment;
    }

    try {
      const response = await axios.get(this.shipmentUrl(shipmentId), {
        headers: await this.headers(),
        timeout: 8000,
      });
      return this.expandShipmentGraph(response.data, { depth: this.config.oneRecord.maxTraversalDepth });
    } catch (error) {
      this.logger.warn({ error: error.message, shipmentId }, "ONE Record shipment fetch failed");
      return shipmentId === referenceShipment["@id"] ? referenceShipment : null;
    }
  }

  async expandShipmentGraph(payload, { depth = 1, seen = new Set() } = {}) {
    if (!payload || depth < 0) {
      return payload;
    }

    const objectId = payload["@id"];
    if (objectId && seen.has(objectId)) {
      return payload;
    }
    if (objectId) {
      seen.add(objectId);
    }

    const expanded = Array.isArray(payload) ? [...payload] : { ...payload };
    const entries = Array.isArray(expanded) ? expanded.entries() : Object.entries(expanded);

    for (const [key, value] of entries) {
      if (Array.isArray(value)) {
        expanded[key] = await Promise.all(
          value.map((item) => this.expandLinkedNode(item, depth, seen)),
        );
      } else if (isObject(value)) {
        expanded[key] = await this.expandLinkedNode(value, depth, seen);
      }
    }

    return expanded;
  }

  async syncOperationalState({ uldId, redisState }) {
    const cached = await this.redis.get(this.twinKey(uldId));
    const parsed = cached ? JSON.parse(cached) : {};
    const payload = {
      ...(parsed.payload || defaultTwinPayload(this.config.oneRecord.baseUrl, uldId)),
      operationalState: buildOperationalStateNode(redisState),
    };
    await this.updateUld(uldId, payload);
    await this.redis.set(
      this.twinKey(uldId),
      JSON.stringify({
        payload,
        operationalState: redisState,
        lastSyncedAt: new Date().toISOString(),
        syncStatus: "SYNCED",
      }),
    );
  }

  async write(method, url, payload) {
    if (!this.config.oneRecord.enabled) {
      return null;
    }

    try {
      const response = await axios({
        method,
        url,
        data: payload,
        headers: await this.headers(),
        timeout: 5000,
      });
      return response.data;
    } catch (error) {
      this.logger.warn({ error: error.message, url }, "ONE Record write failed");
      return null;
    }
  }

  async headers() {
    const token = await this.authService.getAccessToken();
    return {
      "Content-Type": "application/ld+json",
      Accept: "application/ld+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  baseCollectionUrl() {
    return `${this.config.oneRecord.baseUrl}${this.config.oneRecord.apiPath}`;
  }

  shipmentsCollectionUrl() {
    return `${this.config.oneRecord.baseUrl}${this.config.oneRecord.shipmentsPath}`;
  }

  uldUrl(uldId) {
    return `${this.baseCollectionUrl()}/${uldId}`;
  }

  shipmentUrl(shipmentId) {
    if (String(shipmentId).startsWith("http")) {
      return shipmentId;
    }
    return `${this.shipmentsCollectionUrl()}/${shipmentId}`;
  }

  async expandLinkedNode(node, depth, seen) {
    if (!isObject(node)) {
      return node;
    }

    if (depth <= 0) {
      return node;
    }

    const keys = Object.keys(node);
    const onlyReference = keys.length <= 2 && node["@id"] && !node["@type"]?.includes?.("https://onerecord.iata.org/ns/cargo#Shipment");
    if (onlyReference && String(node["@id"]).startsWith("http")) {
      try {
        const response = await axios.get(node["@id"], {
          headers: await this.headers(),
          timeout: 8000,
        });
        return this.expandShipmentGraph(response.data, { depth: depth - 1, seen });
      } catch (error) {
        this.logger.warn({ error: error.message, ref: node["@id"] }, "ONE Record graph expansion failed");
      }
    }

    return this.expandShipmentGraph(node, { depth: depth - 1, seen });
  }
}

function buildTwinPayload({ baseUrl, reading, status, risk, actions, workflows, context, flight }) {
  return {
    "@context": "https://onerecord.iata.org/ns/cargo",
    "@id": `${baseUrl}/ulds/${reading.uld_id}`,
    "@type": "LogisticsObject",
    serialNumber: reading.uld_id,
    linkedFlight: {
      "@type": "FlightMovement",
      flightNumber: flight?.id || "EK202",
      origin: flight?.originAirport || "DXB",
      destination: flight?.destinationAirport || "LHR",
      stage: flight?.stage || "TRANSFER_HUB",
      status: flight?.status || "DELAYED",
    },
    latestTemperatureRecord: {
      "@type": "TemperatureRecord",
      measuredAtTime: reading.timestamp,
      temperatureValue: reading.temperature_celsius,
      unit: "CEL",
      location: {
        "@type": "Location",
        lat: reading.lat,
        lon: reading.lon,
        airportCode: reading.airport_code,
      },
    },
    temperatureComplianceStatus: {
      "@type": "TemperatureComplianceStatus",
      rangeMin: status.minTempC ?? 2,
      rangeMax: status.maxTempC ?? 8,
      exposureUsedMinutes: status.exposureUsed,
      exposureRemainingMinutes: status.exposureRemaining,
      status: normalizeComplianceStatus(status.status),
    },
    riskAssessment: {
      "@type": "RiskAssessment",
      riskScore: risk?.risk_score ?? 0,
      riskLevel: risk?.risk_level ?? "LOW",
      predictedBreachMinutes: risk?.time_to_breach_minutes ?? status.timeToThresholdBreachMinutes ?? 0,
    },
    operationalState: buildOperationalStateNode(status),
    operationalContext: {
      "@type": "OperationalContext",
      airportZone: context?.airportZone,
      delayDetected: context?.delayDetected,
      handlingGap: context?.handlingGap,
      tarmacExposure: context?.tarmacExposure,
      transferExposure: context?.transferExposure,
      inFlightExposure: context?.inFlightExposure,
      ambientTemp: context?.ambientTemp,
    },
    interventions: actions.map((action) => ({
      "@type": "LogisticsEvent",
      action: action.action,
      assignedRole: action.assignedRole,
      priority: action.priority,
      slaDeadline: action.slaDeadline,
      status: action.status,
    })),
    workflowExecutions: workflows.map((workflow) => ({
      "@type": "LogisticsEvent",
      name: workflow.name,
      status: workflow.status,
    })),
  };
}

function buildOperationalStateNode(status) {
  return {
    uldId: status.uldId,
    shipmentId: status.shipmentId,
    productType: status.productType,
    exposureUsed: status.exposureUsed,
    exposureRemaining: status.exposureRemaining,
    allowableExposureMinutes: status.allowableExposureMinutes,
    status: status.status,
    phaseExposure: status.phaseExposure,
    exposureRatePerHour: status.exposureRatePerHour,
    timeToThresholdBreachMinutes: status.timeToThresholdBreachMinutes,
    lastTemperatureCelsius: status.lastTemperatureCelsius,
    lastReadingAt: status.lastReadingAt,
    lastLocation: status.lastLocation,
    lastRisk: status.lastRisk,
    operationalContext: status.operationalContext,
  };
}

function normalizeTwin(payload) {
  return {
    payload,
    operationalState: payload.operationalState || null,
    lastSyncedAt: new Date().toISOString(),
    syncStatus: "SYNCED",
  };
}

function defaultTwinPayload(baseUrl, uldId) {
  return {
    "@context": "https://onerecord.iata.org/ns/cargo",
    "@id": `${baseUrl}/ulds/${uldId}`,
    "@type": "LogisticsObject",
    serialNumber: uldId,
  };
}

function normalizeComplianceStatus(status) {
  if (status === "BREACH") return "Breach";
  if (status === "AT_RISK") return "AtRisk";
  return "OK";
}

function normalizeShipmentCollection(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  if (Array.isArray(payload?.results)) {
    return payload.results;
  }
  return payload ? [payload] : [];
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
