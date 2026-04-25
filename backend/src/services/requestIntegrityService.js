import crypto from "crypto";

export class RequestIntegrityService {
  constructor({ redis, config }) {
    this.redis = redis;
    this.config = config;
  }

  async assertTrustedRequest({ headers, body, channel = "integration" }) {
    const timestampHeader = firstHeader(headers, "x-timestamp");
    const nonce = firstHeader(headers, "x-nonce");
    const eventId = firstHeader(headers, "x-event-id");
    const signature = firstHeader(headers, "x-signature");

    if (!timestampHeader || !nonce || !eventId) {
      throw new RequestValidationError(
        400,
        "x-timestamp, x-nonce, and x-event-id headers are required",
      );
    }

    const timestampMs = Date.parse(timestampHeader);
    if (Number.isNaN(timestampMs)) {
      throw new RequestValidationError(400, "x-timestamp must be a valid ISO8601 value");
    }

    const ageSeconds = Math.abs(Date.now() - timestampMs) / 1000;
    if (ageSeconds > this.config.security.requestFreshnessSeconds) {
      throw new RequestValidationError(409, "Request timestamp is stale");
    }

    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(nonce)) {
      throw new RequestValidationError(400, "x-nonce must be 8-128 safe characters");
    }

    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(eventId)) {
      throw new RequestValidationError(400, "x-event-id must be 8-128 safe characters");
    }

    if (this.config.security.requireSignedIntegrations) {
      if (!signature) {
        throw new RequestValidationError(401, "x-signature header is required");
      }
      if (!this.config.security.integrationSignatureSecret) {
        throw new RequestValidationError(
          500,
          "Integration signature secret is not configured",
        );
      }

      const payloadDigest = signEnvelope({
        secret: this.config.security.integrationSignatureSecret,
        timestamp: timestampHeader,
        nonce,
        eventId,
        body,
      });

      const signatureBuffer = Buffer.from(String(signature), "utf8");
      const digestBuffer = Buffer.from(payloadDigest, "utf8");
      const valid =
        signatureBuffer.length === digestBuffer.length
        && crypto.timingSafeEqual(signatureBuffer, digestBuffer);

      if (!valid) {
        throw new RequestValidationError(401, "Invalid integration signature");
      }
    }

    const replayKey = `integrity:${channel}:${eventId}:${nonce}`;
    const existing = await this.redis.get(replayKey);
    if (existing) {
      throw new RequestValidationError(409, "Replay detected for event id or nonce");
    }
    await this.redis.setEx(
      replayKey,
      this.config.security.requestFreshnessSeconds,
      JSON.stringify({
        recordedAt: new Date().toISOString(),
        timestamp: timestampHeader,
      }),
    );

    return {
      timestamp: timestampHeader,
      nonce,
      eventId,
    };
  }
}

export class RequestValidationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function signEnvelope({ secret, timestamp, nonce, eventId, body }) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${eventId}.${JSON.stringify(body)}`)
    .digest("hex");
}

function firstHeader(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()] ?? headers?.[name.toUpperCase()];
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return value ? String(value) : "";
}
