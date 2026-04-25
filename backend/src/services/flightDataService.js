import axios from "axios";

export class FlightDataService {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
  }

  async getFlights(query = {}) {
    if (!this.config.flightData.baseUrl || !this.config.flightData.apiKey) {
      if (this.config.platform.productionMode && !this.config.platform.allowSimulatorData) {
        return [];
      }

      return [{
        id: this.config.operations.primaryFlightNumber,
        flight_number: this.config.operations.primaryFlightNumber,
        origin: this.config.operations.originAirport,
        destination: this.config.operations.destinationAirport,
        route: `${this.config.operations.originAirport}-${this.config.operations.destinationAirport}`,
        airline: this.config.operations.airlineCode,
        aircraft: "B777F",
        aircraftType: "B777F",
        status: "Delayed",
        delay_minutes: 48,
        delayMinutes: 48,
        source: "development-configured-flight",
      }];
    }

    try {
      const response = await axios.get(this.config.flightData.baseUrl, {
        params: query,
        headers: {
          Authorization: `Bearer ${this.config.flightData.apiKey}`,
          Accept: "application/json",
        },
        timeout: 8000,
      });

      return normalizeFlights(response.data);
    } catch (error) {
      this.logger.warn({ error: error.message }, "Flight data lookup failed");
      return [];
    }
  }
}

function normalizeFlights(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.data || payload?.flights || [];
  return rows.map((row, index) => ({
    id: row.id || row.flight_number || row.flightNumber || `flight-${index + 1}`,
    flight_number: row.flight_number || row.flightNumber || row.number || "UNKNOWN",
    origin: row.origin || row.departure || row.departure_airport || "UNK",
    destination: row.destination || row.arrival || row.arrival_airport || "UNK",
    route: `${row.origin || row.departure || "UNK"}-${row.destination || row.arrival || "UNK"}`,
    airline: row.airline || row.carrier || "UNK",
    aircraft: row.aircraft || row.aircraft_type || "UNK",
    aircraftType: row.aircraftType || row.aircraft_type || row.aircraft || "UNK",
    status: row.status || "UNKNOWN",
    delay_minutes: Number(row.delay_minutes || row.delayMinutes || 0),
    delayMinutes: Number(row.delay_minutes || row.delayMinutes || 0),
    source: "flight-provider",
  }));
}
