import { schemaRegistry } from "./schemas.js";

export function buildOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "AeroSentinel Integration API",
      version: "1.0.0",
      description: "Production-grade integration contracts for AeroSentinel live data ingestion and operational adapters.",
    },
    paths: {
      "/api/integrations/iot/http": {
        post: {
          summary: "Ingest trusted IoT telemetry",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TelemetryIngest" },
              },
            },
          },
          responses: {
            "202": { description: "Telemetry accepted" },
            "400": { description: "Validation failed" },
            "409": { description: "Replay or stale request rejected" },
          },
        },
      },
      "/api/integrations/twilio/status": {
        post: {
          summary: "Receive Twilio delivery status webhook",
          requestBody: {
            required: true,
            content: {
              "application/x-www-form-urlencoded": {
                schema: { $ref: "#/components/schemas/TwilioStatusWebhook" },
              },
            },
          },
          responses: {
            "202": { description: "Webhook accepted" },
            "400": { description: "Validation failed" },
            "401": { description: "Signature invalid" },
          },
        },
      },
      "/api/integrations/whatsapp/commands": {
        post: {
          summary: "Receive WhatsApp operational command webhook",
          requestBody: {
            required: true,
            content: {
              "application/x-www-form-urlencoded": {
                schema: { $ref: "#/components/schemas/WhatsAppCommand" },
              },
            },
          },
          responses: {
            "202": { description: "Command accepted" },
          },
        },
      },
      "/api/flights": {
        get: {
          summary: "Fetch live flight operational state",
          parameters: [
            { in: "query", name: "flightNumber", schema: { type: "string" } },
            { in: "query", name: "origin", schema: { type: "string" } },
            { in: "query", name: "destination", schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Flight state list" },
          },
        },
      },
      "/api/weather/metar": {
        get: {
          summary: "Fetch live METAR weather for airport",
          parameters: [
            { in: "query", name: "airport", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "METAR response" },
          },
        },
      },
    },
    components: {
      schemas: schemaRegistry,
    },
  };
}
