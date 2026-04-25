import {
  aiOpsQuerySchema,
  alertSubscriptionSchema,
  cargoMutationSchema,
  flightQuerySchema,
  metarQuerySchema,
  telemetryIngestSchema,
  twilioStatusWebhookSchema,
  whatsappCommandSchema,
} from "./schemas.js";

export function validateTelemetryReading(payload) {
  if (!isObject(payload)) {
    return error(400, "Telemetry object body required");
  }

  for (const field of telemetryIngestSchema.required) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === "") {
      return error(400, `Missing field ${field}`);
    }
  }

  if (!isFiniteNumber(payload.temperature_celsius, -80, 80)) {
    return error(422, "temperature_celsius outside plausible range");
  }
  if (payload.humidity_percent !== undefined && !isFiniteNumber(payload.humidity_percent, 0, 100)) {
    return error(422, "humidity_percent outside plausible range");
  }
  if (!isFiniteNumber(payload.lat, -90, 90)) {
    return error(422, "lat must be between -90 and 90");
  }
  if (!isFiniteNumber(payload.lon, -180, 180)) {
    return error(422, "lon must be between -180 and 180");
  }
  if (!isIsoDate(payload.timestamp)) {
    return error(400, "timestamp must be valid ISO8601");
  }
  return null;
}

export function validateCargoMutation(payload) {
  if (!isObject(payload)) {
    return error(400, "Cargo event object body required");
  }

  for (const field of cargoMutationSchema.required) {
    if (!String(payload[field] || "").trim()) {
      return error(400, `${field} is required`);
    }
  }

  if (!/^[A-Z0-9-]{4,64}$/i.test(String(payload.cargo_id || ""))) {
    return error(400, "cargo_id is required");
  }
  if (!isIsoDate(payload.timestamp)) {
    return error(400, "timestamp must be valid ISO8601");
  }
  return null;
}

export function validateAiOpsQuery(payload) {
  const prompt = String(payload?.prompt || "").trim();
  if (!prompt) {
    return error(400, "prompt is required");
  }
  if (prompt.length > aiOpsQuerySchema.properties.prompt.maxLength) {
    return error(413, "prompt exceeds 2000 characters");
  }
  return null;
}

export function validateAlertSubscription(payload) {
  if (!isObject(payload)) {
    return error(400, "Subscription object body required");
  }

  const webhookUrl = String(payload.webhookUrl || "").trim();
  const email = String(payload.email || "").trim();

  if (!webhookUrl && !email) {
    return error(400, "webhookUrl or email required");
  }

  if (webhookUrl) {
    try {
      const parsed = new URL(webhookUrl);
      if (!["https:", "http:"].includes(parsed.protocol)) {
        return error(400, "webhookUrl must use http or https");
      }
    } catch {
      return error(400, "webhookUrl must be a valid URL");
    }
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return error(400, "email must be valid");
  }

  return null;
}

export function validateMetarQuery(query) {
  const airport = String(query?.airport || "").trim().toUpperCase();
  if (!airport || airport.length < metarQuerySchema.properties.airport.minLength || airport.length > metarQuerySchema.properties.airport.maxLength) {
    return error(400, "airport query param is required");
  }
  return null;
}

export function validateFlightQuery(query) {
  if (!isObject(query)) {
    return null;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value && !String(value).trim()) {
      return error(400, `${key} must not be empty`);
    }
  }
  return null;
}

export function validateTwilioStatusWebhook(payload) {
  if (!isObject(payload)) {
    return error(400, "Twilio webhook body required");
  }

  for (const field of twilioStatusWebhookSchema.required) {
    if (!String(payload[field] || "").trim()) {
      return error(400, `${field} is required`);
    }
  }
  return null;
}

export function validateWhatsAppCommand(payload) {
  if (!isObject(payload)) {
    return error(400, "WhatsApp command body required");
  }

  for (const field of whatsappCommandSchema.required) {
    if (!String(payload[field] || "").trim()) {
      return error(400, `${field} is required`);
    }
  }
  return null;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value, min, max) {
  return Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;
}

function isIsoDate(value) {
  return !!String(value || "").trim() && !Number.isNaN(Date.parse(value));
}

function error(status, error) {
  return { status, error };
}
