export const telemetryIngestSchema = {
  $id: "TelemetryIngest",
  type: "object",
  required: ["uld_id", "timestamp", "temperature_celsius", "lat", "lon"],
  properties: {
    uld_id: { type: "string", minLength: 3, maxLength: 64 },
    timestamp: { type: "string", format: "date-time" },
    temperature_celsius: { type: "number", minimum: -80, maximum: 80 },
    humidity_percent: { type: "number", minimum: 0, maximum: 100 },
    lat: { type: "number", minimum: -90, maximum: 90 },
    lon: { type: "number", minimum: -180, maximum: 180 },
    battery_percent: { type: "number", minimum: 0, maximum: 100 },
  },
  additionalProperties: true,
};

export const cargoMutationSchema = {
  $id: "CargoMutation",
  type: "object",
  required: ["cargo_id", "timestamp", "location", "handler", "team"],
  properties: {
    cargo_id: { type: "string", minLength: 4, maxLength: 64 },
    flight: { type: "string", minLength: 2, maxLength: 24 },
    timestamp: { type: "string", format: "date-time" },
    location: { type: "string", minLength: 2, maxLength: 256 },
    handler: { type: "string", minLength: 2, maxLength: 128 },
    team: { type: "string", minLength: 2, maxLength: 128 },
    reason: { type: "string", maxLength: 512 },
  },
  additionalProperties: true,
};

export const aiOpsQuerySchema = {
  $id: "AiOpsQuery",
  type: "object",
  required: ["prompt"],
  properties: {
    prompt: { type: "string", minLength: 1, maxLength: 2000 },
  },
  additionalProperties: false,
};

export const alertSubscriptionSchema = {
  $id: "AlertSubscription",
  type: "object",
  properties: {
    webhookUrl: { type: "string", format: "uri" },
    email: { type: "string", format: "email" },
  },
  additionalProperties: false,
};

export const twilioStatusWebhookSchema = {
  $id: "TwilioStatusWebhook",
  type: "object",
  required: ["MessageSid", "MessageStatus"],
  properties: {
    MessageSid: { type: "string", minLength: 10, maxLength: 64 },
    MessageStatus: { type: "string", minLength: 2, maxLength: 64 },
    To: { type: "string", minLength: 2, maxLength: 64 },
    From: { type: "string", minLength: 2, maxLength: 64 },
    ErrorCode: { type: "string", maxLength: 32 },
  },
  additionalProperties: true,
};

export const whatsappCommandSchema = {
  $id: "WhatsAppCommand",
  type: "object",
  required: ["Body", "From"],
  properties: {
    Body: { type: "string", minLength: 1, maxLength: 2000 },
    From: { type: "string", minLength: 2, maxLength: 64 },
    Latitude: { type: "string", maxLength: 32 },
    Longitude: { type: "string", maxLength: 32 },
    MediaUrl0: { type: "string", format: "uri" },
  },
  additionalProperties: true,
};

export const metarQuerySchema = {
  $id: "MetarQuery",
  type: "object",
  required: ["airport"],
  properties: {
    airport: { type: "string", minLength: 3, maxLength: 4 },
  },
  additionalProperties: false,
};

export const flightQuerySchema = {
  $id: "FlightQuery",
  type: "object",
  properties: {
    flightNumber: { type: "string", minLength: 2, maxLength: 16 },
    origin: { type: "string", minLength: 3, maxLength: 4 },
    destination: { type: "string", minLength: 3, maxLength: 4 },
  },
  additionalProperties: false,
};

export const schemaRegistry = {
  TelemetryIngest: telemetryIngestSchema,
  CargoMutation: cargoMutationSchema,
  AiOpsQuery: aiOpsQuerySchema,
  AlertSubscription: alertSubscriptionSchema,
  TwilioStatusWebhook: twilioStatusWebhookSchema,
  WhatsAppCommand: whatsappCommandSchema,
  MetarQuery: metarQuerySchema,
  FlightQuery: flightQuerySchema,
};
