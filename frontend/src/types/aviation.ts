// Aviation-specific types for AeroSentinel operational platform

export interface FlightPosition {
  flightNumber: string;
  registration: string;
  origin: string;
  destination: string;
  eta: string;
  delay: number;
  altitude: number;
  heading: number;
  speed: number;
  lat: number;
  lon: number;
  status: "AIRBORNE" | "GROUND" | "BOARDING" | "DELAYED" | "DIVERTED" | "LANDED";
  aircraftType: string;
  cargoCapacity: number;
  lastUpdate: string;
}

export interface ULDPosition {
  id: string;
  type: "AKE" | "AMP" | "AMA" | "AAP";
  flightNumber: string;
  lat: number;
  lon: number;
  airport: string;
  zone: GeofenceZone;
  temperature: number;
  humidity: number;
  shockEvents: number;
  tiltEvents: number;
  batteryLevel: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  exposureScore: number;
  status: "IN_TRANSIT" | "STORED" | "LOADING" | "UNLOADING" | "HELD";
  lastUpdate: string;
}

export type GeofenceZone = 
  | "AIRPORT_PERIMETER"
  | "APRON"
  | "WAREHOUSE"
  | "COLD_ROOM"
  | "CUSTOMS_HOLD"
  | "TRANSFER_CORRIDOR"
  | "AIRCRAFT_HOLD"
  | "RUNWAY_SAFETY"
  | "EMERGENCY_LANDING"
  | "TOWER_RADIUS"
  | "TARMAC"
  | "RAMP_BUFFER";

export interface GeofenceZone {
  id: string;
  name: string;
  type: GeofenceZone;
  airport: string;
  coordinates: [number, number][];
  altitudeFloor?: number;
  altitudeCeiling?: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  rules: GeofenceRule[];
}

export interface GeofenceRule {
  condition: "ENTER" | "EXIT" | "DWELL_TIME";
  threshold?: number; // seconds for DWELL_TIME
  action: "ALERT" | "ESCALATE" | "NOTIFY_TOWER";
  severity: "INFO" | "WARN" | "HIGH" | "CRITICAL" | "EMERGENCY";
}

export interface Alert {
  id: string;
  severity: "INFO" | "WARN" | "HIGH" | "CRITICAL" | "EMERGENCY";
  type: AlertType;
  title: string;
  description: string;
  flightNumber?: string;
  uldId?: string;
  airport?: string;
  zone?: GeofenceZone;
  lat?: number;
  lon?: number;
  timestamp: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolved: boolean;
  resolvedAt?: string;
  assignedTeam?: string;
  recommendedAction?: string;
  nearestLandingSite?: LandingSite;
  countdownMinutes?: number;
}

export type AlertType =
  | "THERMAL_BREACH"
  | "GEOFENCE_VIOLATION"
  | "DELAY_ESCALATION"
  | "CUSTODY_BREAK"
  | "SHOCK_EVENT"
  | "TILT_EVENT"
  | "BATTERY_LOW"
  | "WEATHER_ALERT"
  | "DIVERSION_RECOMMENDED"
  | "TOWER_NOTIFICATION";

export interface LandingSite {
  icaoCode: string;
  iataCode: string;
  name: string;
  lat: number;
  lon: number;
  distance: number; // nautical miles
  eta: number; // minutes
  runwayLength: number;
  elevation: number;
  weather: WeatherCondition;
  cargoCapabilities: CargoCapability[];
  coldStorageAvailable: boolean;
  coldStorageTemp?: number;
  cargoTeamReady: boolean;
  runwayStatus: "OPEN" | "CLOSED" | "LIMITED";
  atcFrequency: string;
}

export interface CargoCapability {
  type: "PHARMA" | "PERISHABLE" | "DANGEROUS_GOODS" | "VALUABLE" | "LIVE_ANIMALS";
  certified: boolean;
  capacity?: number;
}

export interface WeatherCondition {
  temperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  visibility: number;
  conditions: "CLEAR" | "CLOUDY" | "RAIN" | "STORM" | "FOG" | "SNOW";
  metar: string;
}

export interface TelemetryPoint {
  timestamp: string;
  uldId: string;
  temperature: number;
  humidity: number;
  shock: number;
  tilt: number;
  battery: number;
  lat: number;
  lon: number;
}

export interface ONERecordEvent {
  id: string;
  type: ONERecordEventType;
  timestamp: string;
  actor: string;
  resourceId: string;
  resourceType: "ULD" | "FLIGHT" | "SHIPMENT" | "ALERT";
  previousState?: Record<string, unknown>;
  newState: Record<string, unknown>;
  metadata: {
    source: string;
    correlationId?: string;
    flightNumber?: string;
    airport?: string;
  };
}

export type ONERecordEventType =
  | "SENSOR_UPDATED"
  | "EXPOSURE_DETECTED"
  | "RISK_ESCALATED"
  | "DIVERSION_RECOMMENDED"
  | "TOWER_NOTIFIED"
  | "HANDLER_ASSIGNED"
  | "CARGO_RECOVERED"
  | "INCIDENT_CLOSED"
  | "GEOFENCE_ENTERED"
  | "GEOFENCE_EXITED"
  | "FLIGHT_STATUS_CHANGED"
  | "ULD_POSITION_UPDATED";

export interface TowerNotification {
  id: string;
  towerId: string;
  towerName: string;
  alertId: string;
  channel: "DASHBOARD" | "SMS" | "WHATSAPP" | "EMAIL" | "VOICE" | "WEBHOOK";
  sentAt: string;
  deliveredAt?: string;
  acknowledgedAt?: string;
  responseTime?: number;
  status: "SENT" | "DELIVERED" | "ACKNOWLEDGED" | "ESCALATED" | "FAILED";
  escalationLevel: number;
}

export interface InterventionTask {
  id: string;
  alertId: string;
  uldId: string;
  flightNumber?: string;
  action: string;
  assignedTeam: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  dueAt: string;
  createdAt: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "VERIFIED" | "ESCALATED";
  completedAt?: string;
  verifiedAt?: string;
  verificationData?: Record<string, unknown>;
}

export interface AirportNode {
  icaoCode: string;
  iataCode: string;
  name: string;
  lat: number;
  lon: number;
  elevation: number;
  timezone: string;
  runways: RunwayInfo[];
  cargoTerminals: CargoTerminalInfo[];
  controlTower: {
    frequency: string;
    callsign: string;
    operationalHours: string;
  };
  weather?: WeatherCondition;
  status: "OPERATIONAL" | "LIMITED" | "CLOSED";
}

export interface RunwayInfo {
  designation: string;
  length: number;
  width: number;
  surface: string;
  status: "OPEN" | "CLOSED" | "MAINTENANCE";
  lighting: boolean;
  ils: boolean;
}

export interface CargoTerminalInfo {
  name: string;
  type: "COLD_STORAGE" | "GENERAL" | "PHARMA" | "DANGEROUS_GOODS";
  capacity: number;
  currentUtilization: number;
  temperatureRange?: [number, number];
  certified: string[];
}

// Time window types for charts
export type TimeWindow = "15M" | "1H" | "6H" | "24H" | "7D";

export interface ChartDataPoint {
  timestamp: string;
  value: number;
  label?: string;
}

export interface TelemetryChart {
  uldId: string;
  metric: "temperature" | "humidity" | "exposure" | "shock" | "tilt" | "battery";
  window: TimeWindow;
  data: ChartDataPoint[];
  threshold?: {
    warning: number;
    critical: number;
  };
}