import type {
  FlightPosition,
  ULDPosition,
  Alert,
  TelemetryPoint,
  ONERecordEvent,
  WeatherCondition,
  LandingSite,
} from "../types/aviation";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

// WebSocket connection for real-time updates
class RealtimeService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private listeners: Map<string, Set<Function>> = new Map();
  private flightData: Map<string, FlightPosition> = new Map();
  private uldData: Map<string, ULDPosition> = new Map();
  private alertData: Map<string, Alert> = new Map();
  private telemetryHistory: Map<string, TelemetryPoint[]> = new Map();

  connect() {
    try {
      const wsUrl = API_URL.replace("http", "ws").replace("https", "wss") + "/ws";
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("[RealtimeService] Connected to WebSocket");
        this.reconnectAttempts = 0;
        this.emit("connected", {});
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error("[RealtimeService] Failed to parse message:", error);
        }
      };

      this.ws.onclose = () => {
        console.log("[RealtimeService] WebSocket closed, attempting reconnect...");
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error("[RealtimeService] WebSocket error:", error);
      };
    } catch (error) {
      console.error("[RealtimeService] Failed to connect:", error);
      this.attemptReconnect();
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      setTimeout(() => this.connect(), delay);
    } else {
      console.log("[RealtimeService] Max reconnect attempts reached, using polling fallback");
      this.startPolling();
    }
  }

  private startPolling() {
    // Fallback to polling if WebSocket fails
    setInterval(() => this.pollFlightData(), 10000);
    setInterval(() => this.pollULDData(), 15000);
    setInterval(() => this.pollAlerts(), 5000);
  }

  private handleMessage(message: { type: string; payload: unknown }) {
    switch (message.type) {
      case "FLIGHT_UPDATE":
        this.handleFlightUpdate(message.payload as FlightPosition);
        break;
      case "ULD_UPDATE":
        this.handleULDUpdate(message.payload as ULDPosition);
        break;
      case "ALERT":
        this.handleAlert(message.payload as Alert);
        break;
      case "TELEMETRY":
        this.handleTelemetry(message.payload as TelemetryPoint);
        break;
      case "ONE_RECORD_EVENT":
        this.handleONERecordEvent(message.payload as ONERecordEvent);
        break;
      case "WEATHER_UPDATE":
        this.emit("weather", message.payload);
        break;
      default:
        console.log("[RealtimeService] Unknown message type:", message.type);
    }
  }

  private handleFlightUpdate(flight: FlightPosition) {
    this.flightData.set(flight.flightNumber, flight);
    this.emit("flightUpdate", flight);
    this.emit("flights", this.getFlights());
  }

  private handleULDUpdate(uld: ULDPosition) {
    this.uldData.set(uld.id, uld);
    this.emit("uldUpdate", uld);
    this.emit("ulds", this.getUlds());
  }

  private handleAlert(alert: Alert) {
    this.alertData.set(alert.id, alert);
    this.emit("alert", alert);
    this.emit("alerts", this.getAlerts());
  }

  private handleTelemetry(telemetry: TelemetryPoint) {
    const history = this.telemetryHistory.get(telemetry.uldId) || [];
    history.push(telemetry);
    // Keep last 1000 points per ULD
    if (history.length > 1000) {
      history.splice(0, history.length - 1000);
    }
    this.telemetryHistory.set(telemetry.uldId, history);
    this.emit("telemetry", telemetry);
  }

  private handleONERecordEvent(event: ONERecordEvent) {
    this.emit("oneRecordEvent", event);
  }

  subscribe(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: unknown) {
    this.listeners.get(event)?.forEach((callback) => callback(data));
  }

  getFlights(): FlightPosition[] {
    return Array.from(this.flightData.values());
  }

  getUlds(): ULDPosition[] {
    return Array.from(this.uldData.values());
  }

  getAlerts(): Alert[] {
    return Array.from(this.alertData.values());
  }

  getTelemetryHistory(uldId: string): TelemetryPoint[] {
    return this.telemetryHistory.get(uldId) || [];
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Flight tracking service with simulated data for demo
export class FlightTrackingService {
  private service: RealtimeService;
  private simulationInterval: number | null = null;

  constructor() {
    this.service = new RealtimeService();
  }

  start() {
    this.service.connect();
    this.startSimulation();
  }

  stop() {
    this.service.disconnect();
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
  }

  subscribe(event: string, callback: Function) {
    return this.service.subscribe(event, callback);
  }

  getFlights() {
    return this.service.getFlights();
  }

  getUlds() {
    return this.service.getUlds();
  }

  getAlerts() {
    return this.service.getAlerts();
  }

  private startSimulation() {
    // Simulate flight data updates
    const flights = this.generateInitialFlights();
    flights.forEach((flight) => {
      this.service["flightData"].set(flight.flightNumber, flight);
    });

    // Simulate ULD data
    const ulds = this.generateInitialUlds();
    ulds.forEach((uld) => {
      this.service["uldData"].set(uld.id, uld);
    });

    // Simulate alerts
    const alerts = this.generateInitialAlerts();
    alerts.forEach((alert) => {
      this.service["alertData"].set(alert.id, alert);
    });

    // Update positions periodically
    this.simulationInterval = window.setInterval(() => {
      this.updateFlightPositions();
      this.updateULDPositions();
      this.maybeGenerateAlert();
    }, 5000);
  }

  private generateInitialFlights(): FlightPosition[] {
    const airports = [
      { code: "JFK", lat: 40.6413, lon: -73.7781 },
      { code: "LHR", lat: 51.47, lon: -0.4614 },
      { code: "DXB", lat: 25.2532, lon: 55.3657 },
      { code: "SIN", lat: 1.3644, lon: 103.9915 },
      { code: "HKG", lat: 22.308, lon: 113.9185 },
      { code: "AMS", lat: 52.3105, lon: 4.7683 },
      { code: "FRA", lat: 50.0379, lon: 8.5622 },
      { code: "NRT", lat: 35.7647, lon: 140.3864 },
      { code: "CDG", lat: 49.0097, lon: 2.5479 },
      { code: "ORD", lat: 41.9742, lon: -87.9073 },
    ];

    const flightNumbers = [
      "EK201", "SQ317", "LH441", "BA117", "AF022", "QR701",
      "CX888", "TK001", "MS985", "ET500", "SV101", "AI131",
    ];

    return flightNumbers.map((flightNum, i) => {
      const origin = airports[i % airports.length];
      const dest = airports[(i + 3) % airports.length];
      const lat = origin.lat + (dest.lat - origin.lat) * (0.3 + Math.random() * 0.4);
      const lon = origin.lon + (dest.lon - origin.lon) * (0.3 + Math.random() * 0.4);

      return {
        flightNumber: flightNum,
        registration: `A6-${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + (i % 26))}`,
        origin: origin.code,
        destination: dest.code,
        eta: new Date(Date.now() + (2 + Math.random() * 6) * 3600000).toISOString(),
        delay: Math.floor(Math.random() * 30) - 5,
        altitude: 35000 + Math.floor(Math.random() * 5000),
        heading: Math.floor(Math.random() * 360),
        speed: 450 + Math.floor(Math.random() * 100),
        lat,
        lon,
        status: Math.random() > 0.1 ? "AIRBORNE" : "DELAYED",
        aircraftType: ["B777F", "B748F", "A359F", "B763F"][i % 4],
        cargoCapacity: 100 + Math.floor(Math.random() * 50),
        lastUpdate: new Date().toISOString(),
      };
    });
  }

  private generateInitialUlds(): ULDPosition[] {
    const zones = ["TARMAC", "WAREHOUSE", "COLD_ROOM", "AIRCRAFT_HOLD", "CUSTOMS_HOLD", "APRON"] as const;
    const statuses = ["IN_TRANSIT", "STORED", "LOADING", "UNLOADING", "HELD"] as const;

    return Array.from({ length: 12 }, (_, i) => ({
      id: `ULD-${1000 + i}`,
      type: ["AKE", "AMP", "AMA", "AAP"][i % 4] as ULDPosition["type"],
      flightNumber: `FL${100 + i}`,
      lat: 40.64 + (Math.random() - 0.5) * 0.02,
      lon: -73.78 + (Math.random() - 0.5) * 0.02,
      airport: ["JFK", "DXB", "LHR", "SIN"][i % 4],
      zone: zones[i % zones.length],
      temperature: 2 + Math.random() * 6,
      humidity: 40 + Math.random() * 30,
      shockEvents: Math.floor(Math.random() * 3),
      tiltEvents: Math.floor(Math.random() * 2),
      batteryLevel: 60 + Math.random() * 40,
      riskLevel: ["LOW", "MEDIUM", "HIGH", "CRITICAL"][Math.floor(Math.random() * 4)] as ULDPosition["riskLevel"],
      exposureScore: Math.floor(Math.random() * 100),
      status: statuses[i % statuses.length],
      lastUpdate: new Date().toISOString(),
    }));
  }

  private generateInitialAlerts(): Alert[] {
    const types = ["THERMAL_BREACH", "GEOFENCE_VIOLATION", "DELAY_ESCALATION", "BATTERY_LOW"] as const;
    const severities = ["INFO", "WARN", "HIGH", "CRITICAL"] as const;

    return Array.from({ length: 6 }, (_, i) => ({
      id: `alert-${i + 1}`,
      severity: severities[i % severities.length],
      type: types[i % types.length],
      title: this.getAlertTitle(types[i % types.length]),
      description: this.getAlertDescription(types[i % types.length]),
      uldId: `ULD-${1000 + (i % 12)}`,
      airport: ["JFK", "DXB", "LHR"][i % 3],
      timestamp: new Date(Date.now() - Math.random() * 3600000).toISOString(),
      acknowledged: i < 2,
      resolved: i < 1,
      recommendedAction: this.getRecommendedAction(types[i % types.length]),
      countdownMinutes: 10 + Math.floor(Math.random() * 30),
    }));
  }

  private getAlertTitle(type: string): string {
    const titles: Record<string, string> = {
      THERMAL_BREACH: "Thermal Threshold Breach Predicted",
      GEOFENCE_VIOLATION: "Unauthorized Zone Entry Detected",
      DELAY_ESCALATION: "Ground Delay Exceeding Threshold",
      BATTERY_LOW: "Sensor Battery Critical",
    };
    return titles[type] || "Alert";
  }

  private getAlertDescription(type: string): string {
    const descriptions: Record<string, string> = {
      THERMAL_BREACH: "Projected thermal threshold breach in 15 minutes. Current temp: 8.2°C",
      GEOFENCE_VIOLATION: "ULD entered restricted ramp area without clearance",
      DELAY_ESCALATION: "Tarmac dwell time exceeded 45-minute threshold",
      BATTERY_LOW: "IoT sensor battery at 12%, estimated 30min remaining",
    };
    return descriptions[type] || "Alert condition detected";
  }

  private getRecommendedAction(type: string): string {
    const actions: Record<string, string> = {
      THERMAL_BREACH: "Move to climate-controlled storage immediately",
      GEOFENCE_VIOLATION: "Verify clearance and escort to approved zone",
      DELAY_ESCALATION: "Expedite loading and notify cargo team",
      BATTERY_LOW: "Dispatch technician for sensor replacement",
    };
    return actions[type] || "Investigate and resolve";
  }

  private updateFlightPositions() {
    this.service["flightData"].forEach((flight, key) => {
      // Simulate movement
      const latDelta = (Math.random() - 0.5) * 0.01;
      const lonDelta = (Math.random() - 0.5) * 0.01;
      flight.lat += latDelta;
      flight.lon += lonDelta;
      flight.heading = (flight.heading + Math.random() * 10 - 5 + 360) % 360;
      flight.lastUpdate = new Date().toISOString();
      this.service["flightData"].set(key, flight);
      this.service.emit("flightUpdate", flight);
    });
  }

  private updateULDPositions() {
    this.service["uldData"].forEach((uld, key) => {
      // Slight temperature variations
      uld.temperature += (Math.random() - 0.5) * 0.2;
      uld.temperature = Math.max(-5, Math.min(25, uld.temperature));
      uld.lastUpdate = new Date().toISOString();

      // Update risk based on temperature
      if (uld.temperature > 8) {
        uld.riskLevel = "HIGH";
      } else if (uld.temperature > 6) {
        uld.riskLevel = "MEDIUM";
      } else {
        uld.riskLevel = "LOW";
      }

      this.service["uldData"].set(key, uld);
      this.service.emit("uldUpdate", uld);
    });
  }

  private maybeGenerateAlert() {
    if (Math.random() > 0.7) {
      const ulds = Array.from(this.service["uldData"].values());
      const uld = ulds[Math.floor(Math.random() * ulds.length)];
      if (uld.riskLevel === "HIGH" || uld.riskLevel === "CRITICAL") {
        const alert: Alert = {
          id: `alert-${Date.now()}`,
          severity: uld.riskLevel === "CRITICAL" ? "CRITICAL" : "HIGH",
          type: "THERMAL_BREACH",
          title: "Thermal Threshold Breach Predicted",
          description: `ULD ${uld.id} temperature at ${uld.temperature.toFixed(1)}°C, exceeding safe threshold`,
          uldId: uld.id,
          airport: uld.airport,
          lat: uld.lat,
          lon: uld.lon,
          timestamp: new Date().toISOString(),
          acknowledged: false,
          resolved: false,
          countdownMinutes: Math.floor(10 + Math.random() * 20),
          recommendedAction: "Move to climate-controlled storage immediately",
        };
        this.service["alertData"].set(alert.id, alert);
        this.service.emit("alert", alert);
      }
    }
  }
}

// Export singleton instance
export const realtimeService = new FlightTrackingService();

// Landing site database
export const landingSites: LandingSite[] = [
  {
    icaoCode: "OMDB",
    iataCode: "DXB",
    name: "Dubai International Airport",
    lat: 25.2532,
    lon: 55.3657,
    distance: 0,
    eta: 0,
    runwayLength: 4000,
    elevation: 62,
    weather: {
      temperature: 35,
      humidity: 60,
      windSpeed: 12,
      windDirection: 320,
      visibility: 10,
      conditions: "CLEAR",
      metar: "OMDB 121200Z 32012KT CAVOK 35/20 Q1010",
    },
    cargoCapabilities: [
      { type: "PHARMA", certified: true, capacity: 500 },
      { type: "PERISHABLE", certified: true, capacity: 800 },
      { type: "DANGEROUS_GOODS", certified: true },
    ],
    coldStorageAvailable: true,
    coldStorageTemp: 4,
    cargoTeamReady: true,
    runwayStatus: "OPEN",
    atcFrequency: "118.75",
  },
  {
    icaoCode: "EGLL",
    iataCode: "LHR",
    name: "London Heathrow Airport",
    lat: 51.47,
    lon: -0.4614,
    distance: 0,
    eta: 0,
    runwayLength: 3902,
    elevation: 83,
    weather: {
      temperature: 15,
      humidity: 78,
      windSpeed: 18,
      windDirection: 270,
      visibility: 8,
      conditions: "CLOUDY",
      metar: "EGLL 121200Z 27018KT 9999 SCT025 15/12 Q1015",
    },
    cargoCapabilities: [
      { type: "PHARMA", certified: true, capacity: 600 },
      { type: "PERISHABLE", certified: true, capacity: 1000 },
      { type: "VALUABLE", certified: true },
    ],
    coldStorageAvailable: true,
    coldStorageTemp: 3,
    cargoTeamReady: true,
    runwayStatus: "OPEN",
    atcFrequency: "119.725",
  },
  {
    icaoCode: "KJFK",
    iataCode: "JFK",
    name: "John F. Kennedy International Airport",
    lat: 40.6413,
    lon: -73.7781,
    distance: 0,
    eta: 0,
    runwayLength: 4423,
    elevation: 13,
    weather: {
      temperature: 22,
      humidity: 65,
      windSpeed: 15,
      windDirection: 220,
      visibility: 10,
      conditions: "CLEAR",
      metar: "KJFK 121200Z 22015KT 10SM FEW250 22/14 Q1020",
    },
    cargoCapabilities: [
      { type: "PHARMA", certified: true, capacity: 700 },
      { type: "PERISHABLE", certified: true, capacity: 1200 },
      { type: "DANGEROUS_GOODS", certified: true },
      { type: "LIVE_ANIMALS", certified: true },
    ],
    coldStorageAvailable: true,
    coldStorageTemp: 2,
    cargoTeamReady: true,
    runwayStatus: "OPEN",
    atcFrequency: "119.1",
  },
  {
    icaoCode: "WSSS",
    iataCode: "SIN",
    name: "Singapore Changi Airport",
    lat: 1.3644,
    lon: 103.9915,
    distance: 0,
    eta: 0,
    runwayLength: 4000,
    elevation: 22,
    weather: {
      temperature: 30,
      humidity: 85,
      windSpeed: 8,
      windDirection: 150,
      visibility: 10,
      conditions: "CLOUDY",
      metar: "WSSS 121200Z 15008KT 9999 SCT020 30/26 Q1010",
    },
    cargoCapabilities: [
      { type: "PHARMA", certified: true, capacity: 400 },
      { type: "PERISHABLE", certified: true, capacity: 900 },
    ],
    coldStorageAvailable: true,
    coldStorageTemp: 4,
    cargoTeamReady: true,
    runwayStatus: "OPEN",
    atcFrequency: "124.9",
  },
  {
    icaoCode: "VHHH",
    iataCode: "HKG",
    name: "Hong Kong International Airport",
    lat: 22.308,
    lon: 113.9185,
    distance: 0,
    eta: 0,
    runwayLength: 3800,
    elevation: 28,
    weather: {
      temperature: 28,
      humidity: 80,
      windSpeed: 10,
      windDirection: 180,
      visibility: 9,
      conditions: "CLOUDY",
      metar: "VHHH 121200Z 18010KT 9999 BKN025 28/24 Q1012",
    },
    cargoCapabilities: [
      { type: "PHARMA", certified: true, capacity: 350 },
      { type: "PERISHABLE", certified: true, capacity: 800 },
      { type: "VALUABLE", certified: true },
    ],
    coldStorageAvailable: true,
    coldStorageTemp: 3,
    cargoTeamReady: true,
    runwayStatus: "OPEN",
    atcFrequency: "118.7",
  },
];

// Calculate nearest landing sites
export function findNearestLandingSites(
  currentLat: number,
  currentLon: number,
  count = 3
): LandingSite[] {
  return landingSites
    .map((site) => {
      const distance = haversineDistance(currentLat, currentLon, site.lat, site.lon);
      const eta = Math.round(distance / 450 * 60); // Assume 450 knots
      return { ...site, distance: Math.round(distance), eta };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440; // Earth's radius in nautical miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}