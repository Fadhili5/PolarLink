import mqtt from "mqtt";

const client = mqtt.connect(process.env.MQTT_URL || "mqtt://localhost:1883");
const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";
const intervalMs = Number.parseInt(process.env.PUBLISH_INTERVAL_MS || "15000", 10);
const ulds = (process.env.ULD_IDS || "JTN-7890,JTN-8972,JTN-4421").split(",");
const deviationProbability = Number.parseFloat(process.env.DEVIATION_PROBABILITY || "0.2");
const alertDemoMode = process.env.ALERT_DEMO_MODE === "true";
const scenario = process.env.SCENARIO || "heatwave";
const cargoIds = (process.env.CARGO_IDS || "AWB-78492,AWB-55110,AWB-11204").split(",");
const cargoIntervalMs = Number.parseInt(process.env.CARGO_PUBLISH_INTERVAL_MS || "20000", 10);

client.on("connect", () => {
  for (const uldId of ulds) {
    let step = 0;
    setInterval(() => {
      const point = nextPoint(uldId, step++);
      client.publish(`uld/${uldId}/telemetry`, JSON.stringify(point));
    }, intervalMs);
  }

  for (const cargoId of cargoIds) {
    let step = 0;
    setInterval(() => {
      void postCargoEvent(nextCargoEvent(cargoId, step++));
    }, cargoIntervalMs);
  }
});

function nextPoint(uldId, step) {
  const route = routePoint(step);
  const deviated = alertDemoMode
    ? shouldForceDeviation(uldId, step)
    : Math.random() < deviationProbability;
  const operational = scenarioState(step, uldId);
  return {
    uld_id: uldId,
    timestamp: new Date().toISOString(),
    temperature_celsius: deviated
      ? 9 + Math.random() * 4
      : 2 + Math.random() * 6,
    lat: route.lat,
    lon: route.lon,
    battery: Math.max(15, 100 - step),
    signal_rssi: operational.signal_rssi,
    speed_kph: operational.speed_kph,
    airport_zone: operational.airport_zone,
    time_on_tarmac_min: operational.time_on_tarmac_min,
    flight_status: operational.flight_status,
    delay_minutes: operational.delay_minutes,
  };
}

function shouldForceDeviation(uldId, step) {
  if (uldId === "JTN-7890") {
    return true;
  }

  if (uldId === "JTN-8972") {
    return step % 3 !== 0;
  }

  return step % 5 === 0;
}

function scenarioState(step, uldId) {
  if (scenario === "delay") {
    return {
      airport_zone: step % 4 < 3 ? "TARMAC" : "AIRPORT_TRANSIT",
      time_on_tarmac_min: 10 + step * 2,
      flight_status: "DELAYED",
      delay_minutes: 20 + step * 3,
      signal_rssi: -82,
      speed_kph: step % 4 === 3 ? 28 : 0,
    };
  }

  if (scenario === "sensor-failure") {
    return {
      airport_zone: "TARMAC",
      time_on_tarmac_min: 12 + step,
      flight_status: "ON_TIME",
      delay_minutes: 0,
      signal_rssi: uldId === "JTN-4421" ? -98 : -88,
      speed_kph: 0,
    };
  }

  return {
    airport_zone: step % 3 === 0 ? "TARMAC" : step % 5 === 0 ? "IN_FLIGHT" : "AIRPORT_TRANSIT",
    time_on_tarmac_min: step % 3 === 0 ? 8 + step : 0,
    flight_status: step % 4 === 0 ? "DELAYED" : "ON_TIME",
    delay_minutes: step % 4 === 0 ? 15 + step : 0,
    signal_rssi: -78,
    speed_kph: step % 5 === 0 ? 680 : step % 3 === 0 ? 0 : 22,
  };
}

function routePoint(step) {
  const path = [
    { lat: 40.6413, lon: -73.7781 },
    { lat: 40.645, lon: -73.77 },
    { lat: 41.2, lon: -50.5 },
    { lat: 51.47, lon: -0.4543 },
  ];
  return path[step % path.length];
}

function nextCargoEvent(cargoId, step) {
  const track = cargoTrack(cargoId, step);
  const action = track.action;
  const endpoint = endpointForAction(action);
  return {
    endpoint,
    payload: {
      cargo_id: cargoId,
      flight: "EK202",
      timestamp: new Date(Date.now() + step * 1000).toISOString(),
      location: track.location,
      zone: track.zone,
      handler: track.handler,
      team: track.team,
      action: track.action,
      reason: track.reason,
      condition: track.condition,
      seal_id: track.sealId,
      weight: track.weight,
      temperature: track.temperature,
      photo_evidence: `https://simulator.aerosentinel.local/${cargoId}/${track.slug}.jpg`,
      video_clip: `https://simulator.aerosentinel.local/${cargoId}/${track.slug}.mp4`,
      signature: `digital:${track.handler}`,
      barcode_scan: track.barcodeScan,
      rfid_scan: track.rfidScan,
      biometric_verified: track.biometricVerified,
      workflow_match: track.workflowMatch,
      weight_match: track.weightMatch,
      seal_match: track.sealMatch,
      destination_match: track.destinationMatch,
      awb_match: track.awbMatch,
      vision_findings: track.visionFindings,
    },
  };
}

function cargoTrack(cargoId, step) {
  const cycle = buildCargoScenario(cargoId);
  return cycle[step % cycle.length];
}

function buildCargoScenario(cargoId) {
  if (cargoId === "AWB-55110") {
    return [
      cargoStep("CargoHeld", "Security Hold / Vault 2", "security-901", "security", "Security Screening", "sealed", "SEAL-4410", "318kg", "6C", "security-hold"),
      cargoStep("CargoOpened", "Security Hold / Inspection Desk", "security-901", "security", "Seal inspection", "opened", "SEAL-4410", "318kg", "7C", "opened", {
        visionFindings: { cargoOpened: true, unauthorizedAccess: false, forkliftPickup: true },
      }),
      cargoStep("CargoTamperAlert", "Security Hold / Vault 2", "security-901", "security", "Broken seal identified", "broken-seal", "SEAL-4410", "314kg", "8C", "tamper", {
        biometricVerified: false,
        sealMatch: false,
        weightMatch: false,
        visionFindings: { brokenSeal: true, unauthorizedAccess: true, cargoOpened: true, packageDamage: true },
      }),
    ];
  }

  if (cargoId === "AWB-11204") {
    return [
      cargoStep("CargoTransferred", "Truck Dock 3", "transfer-404", "transfer_ops", "Bonded transfer to truck", "sealed", "SEAL-7100", "210kg", "7C", "transfer"),
      cargoStep("CargoMissing", "Apron / Truck Dock 3", "transfer-404", "transfer_ops", "Object moved without scan", "unknown", "SEAL-7100", "210kg", "7C", "missing", {
        barcodeScan: null,
        rfidScan: null,
        biometricVerified: false,
        awbMatch: false,
        workflowMatch: false,
        visionFindings: { leftUnattended: true, wrongPalletMoved: true, unauthorizedAccess: true },
      }),
      cargoStep("CustodyViolation", "Bonded Storage / Review Cage", "ops-supervisor-7", "airline_ops", "Manifest mismatch under review", "sealed", "SEAL-7100", "210kg", "6C", "violation", {
        workflowMatch: false,
        destinationMatch: false,
        visionFindings: { cargoSwapped: true, longIdleCargo: true },
      }),
    ];
  }

  return [
    cargoStep("CargoUnloaded", "Aircraft Hold / Position 14", "ground-214", "ground_handlers", "Temperature-controlled transfer", "sealed", "SEAL-9923", "425kg", "4C", "unloaded"),
    cargoStep("CargoScannedOut", "Customs Hold / Bay 4", "customs-118", "customs", "Customs inspection", "sealed", "SEAL-9923", "425kg", "5C", "scan-out"),
    cargoStep("CargoInspected", "Customs Hold / Bay 4", "customs-118", "customs", "X-ray and paperwork check", "sealed", "SEAL-9923", "425kg", "5C", "inspected", {
      visionFindings: { forkliftPickup: true, heatSignatureAnomaly: false },
    }),
    cargoStep("CargoRepacked", "Warehouse B / Repack Cell 2", "cargo-332", "cargo_ops", "Label correction and pallet refresh", "resealed", "SEAL-10024", "424kg", "4C", "repacked"),
    cargoStep("CargoScannedIn", "ULD Staging / Lane 7", "cargo-332", "cargo_ops", "Returned from inspection", "resealed", "SEAL-10024", "424kg", "4C", "scan-in"),
    cargoStep("CargoReloaded", "Aircraft Hold / Position 14", "ops-supervisor-7", "airline_ops", "Manifest reload validation", "resealed", "SEAL-10024", "424kg", "4C", "reloaded"),
  ];
}

function cargoStep(action, location, handler, team, reason, condition, sealId, weight, temperature, slug, overrides = {}) {
  return {
    action,
    location,
    zone: inferCargoZone(location),
    handler,
    team,
    reason,
    condition,
    sealId,
    weight,
    temperature,
    slug,
    barcodeScan: "sim-barcode",
    rfidScan: "sim-rfid",
    biometricVerified: true,
    workflowMatch: true,
    weightMatch: true,
    sealMatch: true,
    destinationMatch: true,
    awbMatch: true,
    visionFindings: {
      cargoRemoved: action === "CargoUnloaded",
      cargoOpened: action === "CargoOpened",
      cargoSwapped: false,
      leftUnattended: false,
      forkliftPickup: action === "CargoTransferred" || action === "CargoInspected",
      wrongPalletMoved: false,
      unauthorizedAccess: false,
      brokenSeal: false,
      packageDamage: action === "CargoDamaged",
      heatSignatureAnomaly: false,
      longIdleCargo: false,
    },
    ...overrides,
  };
}

function inferCargoZone(location) {
  const normalized = location.toLowerCase();
  if (normalized.includes("custom")) return "Customs Hold";
  if (normalized.includes("warehouse")) return "Warehouse";
  if (normalized.includes("truck")) return "Truck Dock";
  if (normalized.includes("bond")) return "Bonded Storage";
  if (normalized.includes("aircraft")) return "Aircraft";
  return "ULD Staging";
}

function endpointForAction(action) {
  if (action === "CargoScannedOut") return "scan-out";
  if (action === "CargoScannedIn") return "scan-in";
  if (action === "CargoReloaded") return "reload";
  return "verify";
}

async function postCargoEvent(item) {
  try {
    await fetch(`${backendUrl}/api/cargo/${item.endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item.payload),
    });
  } catch (error) {
    console.error("[simulator] failed to post cargo event", error);
  }
}
