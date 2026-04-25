import axios from "axios";
import crypto from "crypto";

export class TwilioService {
  constructor({ config, logger, auditStore, redis }) {
    this.config = config;
    this.logger = logger;
    this.auditStore = auditStore;
    this.redis = redis;
  }

  async sendSms({ to, body, metadata }) {
    return this.sendMessage({ to, body, channel: "sms", metadata });
  }

  async sendWhatsApp({ to, body, metadata }) {
    return this.sendMessage({ to, body, channel: "whatsapp", metadata });
  }

  async sendVoice({ to, message }) {
    if (!this.isConfigured()) {
      return { queued: false, provider: "twilio", reason: "not-configured" };
    }

    const url = `${this.config.twilio.baseUrl}/Accounts/${this.config.twilio.accountSid}/Calls.json`;
    try {
      const payload = new URLSearchParams({
        To: to,
        From: this.config.twilio.voiceFrom,
        Twiml: `<Response><Say>${escapeXml(message)}</Say></Response>`,
      });
      const response = await axios.post(url, payload.toString(), {
        auth: {
          username: this.config.twilio.accountSid,
          password: this.config.twilio.authToken,
        },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 8000,
      });
      if (response.data?.sid) {
        await this.mapMessageSid(response.data.sid, metadataFromVoice(to, message));
      }
      return { queued: true, provider: "twilio", channel: "voice", sid: response.data?.sid || null };
    } catch (error) {
      this.logger.warn({ error: error.message }, "Twilio voice request failed");
      return { queued: false, provider: "twilio", reason: "request-failed" };
    }
  }

  validateWebhookSignature({ url, body, signature }) {
    if (!this.config.twilio.authToken) {
      return !this.config.platform.productionMode;
    }

    const expected = buildTwilioSignature({
      authToken: this.config.twilio.authToken,
      url,
      body,
    });

    const expectedBuffer = Buffer.from(expected, "utf8");
    const signatureBuffer = Buffer.from(String(signature || ""), "utf8");
    return (
      expectedBuffer.length === signatureBuffer.length
      && crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
    );
  }

  async recordWebhook(kind, payload) {
    await this.auditStore.log(`twilio-${kind}`, payload);
  }

  async mapMessageSid(messageSid, metadata) {
    if (!this.redis || !messageSid || !metadata) {
      return;
    }
    await this.redis.setEx(
      `twilio:sid:${messageSid}`,
      86400,
      JSON.stringify(metadata),
    );
  }

  async getMappedMessage(messageSid) {
    if (!this.redis || !messageSid) {
      return null;
    }
    const raw = await this.redis.get(`twilio:sid:${messageSid}`);
    return raw ? JSON.parse(raw) : null;
  }

  isConfigured() {
    return !!(this.config.twilio.accountSid && this.config.twilio.authToken);
  }

  async sendMessage({ to, body, channel, metadata }) {
    if (!this.isConfigured()) {
      return { queued: false, provider: "twilio", channel, reason: "not-configured" };
    }

    const url = `${this.config.twilio.baseUrl}/Accounts/${this.config.twilio.accountSid}/Messages.json`;
    const from = channel === "whatsapp" ? this.config.twilio.whatsappFrom : this.config.twilio.smsFrom;
    const normalizedTo = channel === "whatsapp" && !String(to).startsWith("whatsapp:")
      ? `whatsapp:${to}`
      : to;

    try {
      const payload = new URLSearchParams({
        To: normalizedTo,
        From: from,
        Body: body,
        ...(this.config.twilio.messagingServiceSid
          ? { MessagingServiceSid: this.config.twilio.messagingServiceSid }
          : {}),
      });
      const response = await axios.post(url, payload.toString(), {
        auth: {
          username: this.config.twilio.accountSid,
          password: this.config.twilio.authToken,
        },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 8000,
      });
      if (response.data?.sid) {
        await this.mapMessageSid(response.data.sid, metadata || null);
      }
      return { queued: true, provider: "twilio", channel, sid: response.data?.sid || null };
    } catch (error) {
      this.logger.warn({ error: error.message, channel }, "Twilio message request failed");
      return { queued: false, provider: "twilio", channel, reason: "request-failed" };
    }
  }
}

function metadataFromVoice(to, message) {
  return {
    targetId: to,
    channel: "voice",
    preview: String(message || "").slice(0, 120),
  };
}

function buildTwilioSignature({ authToken, url, body }) {
  const entries = Object.entries(body || {}).sort(([left], [right]) => left.localeCompare(right));
  const serialized = `${url}${entries.map(([key, value]) => `${key}${value}`).join("")}`;
  return crypto.createHmac("sha1", authToken).update(serialized).digest("base64");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
