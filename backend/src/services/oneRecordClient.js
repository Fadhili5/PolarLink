import axios from "axios";

export class OneRecordClient {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async ensureValidToken() {
    // Return cached token if still valid (check 5 mins before expiry)
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 300000) {
      return this.accessToken;
    }

    try {
      const token = await this.getKeycloakToken();
      this.accessToken = token;
      // Tokens typically valid for 300s (5 mins), cache for ~4 minutes
      this.tokenExpiry = Date.now() + 240000;
      return token;
    } catch (error) {
      this.logger.error(
        { error: error.message, component: "OneRecordClient" },
        "Failed to get Keycloak token"
      );
      return null;
    }
  }

  async getKeycloakToken() {
    const url = `${this.config.auth.keycloak.endpoint}/realms/${this.config.auth.keycloak.realm}/protocol/openid-connect/token`;

    const credentials = Buffer.from(
      `${this.config.auth.keycloak.clientId}:${this.config.auth.keycloak.clientSecret}`
    ).toString("base64");

    const response = await axios.post(
      url,
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.config.auth.keycloak.clientId,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        timeout: 5000,
      }
    );

    return response.data.access_token;
  }

  async verifyULD(uldId) {
    if (!this.config.oneRecord.enabled) {
      return null;
    }

    try {
      const token = await this.ensureValidToken();
      if (!token) {
        return null;
      }

      // Format: uld-<serial> to match ONE Record naming
      const uldIdentifier = uldId.includes("uld-") ? uldId : `uld-${uldId}`;
      const url = `${this.config.oneRecord.baseUrl}/api/logistics-objects/${uldIdentifier}`;

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/ld+json; version=2.0.0-dev",
        },
        timeout: 5000,
      });

      return this.transformFromOneRecord(response.data);
    } catch (error) {
      this.logger.warn(
        { error: error.message, uldId, component: "OneRecordClient" },
        "Failed to verify ULD against ONE Record"
      );
      return null;
    }
  }

  transformFromOneRecord(oneRecordData) {
    // Extract relevant fields from ONE Record RDF/JSON-LD response
    // This maps ONE Record digital twin to AeroSentinel format
    return {
      id: oneRecordData.serialNumber || 
          oneRecordData["@id"]?.split("/").pop() ||
          oneRecordData["@id"],
      temperature: oneRecordData.latestTemperatureRecord?.temperatureValue,
      humidity: oneRecordData.relativeHumidity?.value,
      lastUpdate: oneRecordData.latestTemperatureRecord?.measuredAtTime,
      airport: oneRecordData.latestTemperatureRecord?.location?.airportCode,
      exposureUsed: oneRecordData.temperatureComplianceStatus?.exposureUsed,
      exposureRemaining: oneRecordData.temperatureComplianceStatus?.exposureRemaining,
      complianceStatus: oneRecordData.temperatureComplianceStatus?.status,
      riskScore: oneRecordData.riskScore?.value,
      riskLevel: oneRecordData.riskScore?.riskLevel,
      timeToBreachMinutes: oneRecordData.riskScore?.timeToBreachMinutes,
    };
  }
}
