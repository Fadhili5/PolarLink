import { useEffect, useRef, useState, useCallback } from "react";
import Map, {
  Marker,
  Popup,
  NavigationControl,
  ScaleControl,
  FullscreenControl,
  AttributionControl,
  Layer,
  Source,
  type MapRef,
  type LngLatLike,
} from "react-map-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FlightPosition, ULDPosition, Alert, LandingSite } from "../../types/aviation";
import { findNearestLandingSites, landingSites } from "../../services/realtimeService";
import { cn } from "../../lib/utils";

const MAPLIBRE_STYLE = "https://demotiles.maplibre.org/style.json";

interface OperationalMapProps {
  flights?: FlightPosition[];
  ulds?: ULDPosition[];
  alerts?: Alert[];
  center?: [number, number];
  zoom?: number;
  showFlights?: boolean;
  showUlds?: boolean;
  showAirports?: boolean;
  showGeofences?: boolean;
  showWeather?: boolean;
  showRiskOverlay?: boolean;
  selectedUldId?: string;
  selectedFlight?: string;
  onUldClick?: (uld: ULDPosition) => void;
  onFlightClick?: (flight: FlightPosition) => void;
  onAirportClick?: (airport: typeof landingSites[0]) => void;
  className?: string;
  height?: string;
}

interface AirportMarkerProps {
  airport: typeof landingSites[0];
  onClick: () => void;
}

interface FlightMarkerProps {
  flight: FlightPosition;
  onClick: () => void;
  selected: boolean;
}

interface UldMarkerProps {
  uld: ULDPosition;
  onClick: () => void;
  selected: boolean;
}

function AirportMarker({ airport, onClick }: AirportMarkerProps) {
  return (
    <Marker
      longitude={airport.lon}
      latitude={airport.lat}
      anchor="center"
      onClick={(e) => {
        e.originalEvent.stopPropagation();
        onClick();
      }}
    >
      <div className="relative cursor-pointer group">
        <div className="w-4 h-4 rounded-full bg-blue-600 border-2 border-white shadow-lg flex items-center justify-center group-hover:scale-125 transition-transform">
          <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
          </svg>
        </div>
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-xs px-2 py-1 rounded pointer-events-none">
          {airport.iataCode}
        </div>
      </div>
    </Marker>
  );
}

function FlightMarker({ flight, onClick, selected }: FlightMarkerProps) {
  const rotation = flight.heading || 0;

  return (
    <Marker
      longitude={flight.lon}
      latitude={flight.lat}
      anchor="center"
      onClick={(e) => {
        e.originalEvent.stopPropagation();
        onClick();
      }}
    >
      <div
        className={cn(
          "relative cursor-pointer transition-all duration-300",
          selected ? "scale-125 z-50" : "scale-100 z-10 hover:scale-110"
        )}
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <div
          className={cn(
            "w-3 h-3 rotate-45 border",
            flight.status === "DELAYED"
              ? "bg-amber-500 border-amber-600"
              : flight.delay < -10
              ? "bg-emerald-500 border-emerald-600"
              : "bg-blue-500 border-blue-600",
            selected && "ring-2 ring-white ring-offset-2 ring-offset-blue-500"
          )}
        />
        <div
          className={cn(
            "absolute inset-0 w-3 h-3 rounded-full animate-ping opacity-30",
            flight.status === "DELAYED" ? "bg-amber-500" : "bg-blue-500"
          )}
        />
      </div>
    </Marker>
  );
}

function UldMarker({ uld, onClick, selected }: UldMarkerProps) {
  const riskColors = {
    LOW: "bg-emerald-500",
    MEDIUM: "bg-amber-500",
    HIGH: "bg-orange-500",
    CRITICAL: "bg-rose-500",
  };

  return (
    <Marker
      longitude={uld.lon}
      latitude={uld.lat}
      anchor="center"
      onClick={(e) => {
        e.originalEvent.stopPropagation();
        onClick();
      }}
    >
      <div
        className={cn(
          "relative cursor-pointer transition-all duration-300",
          selected ? "scale-150 z-50" : "scale-100 z-10 hover:scale-125"
        )}
      >
        <div
          className={cn(
            "w-3.5 h-3.5 rounded-sm border border-white shadow-md",
            riskColors[uld.riskLevel] || "bg-slate-500",
            selected && "ring-2 ring-white ring-offset-2 ring-offset-slate-500"
          )}
        />
        {uld.riskLevel === "CRITICAL" && (
          <div className="absolute inset-0 w-3.5 h-3.5 rounded-sm bg-rose-500 animate-ping opacity-50" />
        )}
      </div>
    </Marker>
  );
}

// Geofence zones for major airports
const geofenceZones = {
  JFK: {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: { type: "AIRPORT_PERIMETER", risk: "LOW" },
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [
              [-73.82, 40.62],
              [-73.75, 40.62],
              [-73.75, 40.66],
              [-73.82, 40.66],
              [-73.82, 40.62],
            ],
          ],
        },
      },
      {
        type: "Feature" as const,
        properties: { type: "TARMAC", risk: "MEDIUM" },
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [
              [-73.80, 40.635],
              [-73.77, 40.635],
              [-73.77, 40.65],
              [-73.80, 40.65],
              [-73.80, 40.635],
            ],
          ],
        },
      },
    ],
  },
  DXB: {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: { type: "AIRPORT_PERIMETER", risk: "LOW" },
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [
              [55.34, 25.23],
              [55.39, 25.23],
              [55.39, 25.27],
              [55.34, 25.27],
              [55.34, 25.23],
            ],
          ],
        },
      },
    ],
  },
};

const riskOverlayStyle: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    "risk-data": {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [],
      },
    },
  },
  layers: [],
};

export function OperationalMap({
  flights = [],
  ulds = [],
  alerts = [],
  center = [0, 20],
  zoom = 2,
  showFlights = true,
  showUlds = true,
  showAirports = true,
  showGeofences = false,
  showRiskOverlay = false,
  selectedUldId,
  selectedFlight,
  onUldClick,
  onFlightClick,
  onAirportClick,
  className,
  height = "100%",
}: OperationalMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [popupInfo, setPopupInfo] = useState<{
    type: "flight" | "uld" | "airport";
    data: FlightPosition | ULDPosition | typeof landingSites[0];
    lngLat: [number, number];
  } | null>(null);

  const handleFlightClick = useCallback(
    (flight: FlightPosition) => {
      setPopupInfo({ type: "flight", data: flight, lngLat: [flight.lon, flight.lat] });
      onFlightClick?.(flight);
    },
    [onFlightClick]
  );

  const handleUldClick = useCallback(
    (uld: ULDPosition) => {
      setPopupInfo({ type: "uld", data: uld, lngLat: [uld.lon, uld.lat] });
      onUldClick?.(uld);
    },
    [onUldClick]
  );

  const handleAirportClick = useCallback(
    (airport: typeof landingSites[0]) => {
      setPopupInfo({ type: "airport", data: airport, lngLat: [airport.lon, airport.lat] });
      onAirportClick?.(airport);
    },
    [onAirportClick]
  );

  // Flight path lines
  const flightPathsGeoJSON = {
    type: "FeatureCollection" as const,
    features: flights.map((flight) => ({
      type: "Feature" as const,
      properties: {
        flightNumber: flight.flightNumber,
        status: flight.status,
      },
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [flight.lon, flight.lat],
          [flight.lon + (Math.random() - 0.5) * 2, flight.lat + (Math.random() - 0.5) * 2],
        ],
      },
    })),
  };

  return (
    <div className={cn("relative rounded-2xl overflow-hidden border border-slate-200 shadow-lg", className)} style={{ height }}>
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: center[0],
          latitude: center[1],
          zoom,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={MAPLIBRE_STYLE}
        attributionControl={false}
        fadeDuration={200}
        onClick={() => setPopupInfo(null)}
      >
        <NavigationControl position="top-right" showCompass={false} />
        <ScaleControl position="bottom-left" />
        <FullscreenControl position="top-right" />
        <AttributionControl
          position="bottom-right"
          customAttribution="© AeroSentinel | © OpenStreetMap contributors"
        />

        {/* Flight path lines */}
        {showFlights && flights.length > 0 && (
          <Source id="flight-paths" type="geojson" data={flightPathsGeoJSON}>
            <Layer
              id="flight-paths"
              type="line"
              paint={{
                "line-color": "#3b82f6",
                "line-width": 1.5,
                "line-dasharray": [4, 4],
                "line-opacity": 0.4,
              }}
            />
          </Source>
        )}

        {/* Geofence zones */}
        {showGeofences && Object.entries(geofenceZones).map(([key, geojson]) => (
          <Source key={key} id={`geofence-${key}`} type="geojson" data={geojson}>
            <Layer
              id={`geofence-fill-${key}`}
              type="fill"
              paint={{
                "fill-color": ["match", ["get", "risk"], "LOW", "rgba(16,185,129,0.15)", "MEDIUM", "rgba(245,158,11,0.15)", "rgba(244,63,94,0.15)"],
                "fill-outline-color": ["match", ["get", "risk"], "LOW", "rgba(16,185,129,0.5)", "MEDIUM", "rgba(245,158,11,0.5)", "rgba(244,63,94,0.5)"],
                "fill-opacity": 0.3,
              }}
            />
            <Layer
              id={`geofence-line-${key}`}
              type="line"
              source={`geofence-${key}`}
              paint={{
                "line-color": ["match", ["get", "risk"], "LOW", "#10b981", "MEDIUM", "#f59e0b", "#f43f5e"],
                "line-width": 2,
                "line-dasharray": [6, 3],
              }}
            />
          </Source>
        ))}

        {/* Airport markers */}
        {showAirports &&
          landingSites.map((airport) => (
            <AirportMarker
              key={airport.icaoCode}
              airport={airport}
              onClick={() => handleAirportClick(airport)}
            />
          ))}

        {/* Flight markers */}
        {showFlights &&
          flights.map((flight) => (
            <FlightMarker
              key={flight.flightNumber}
              flight={flight}
              onClick={() => handleFlightClick(flight)}
              selected={selectedFlight === flight.flightNumber}
            />
          ))}

        {/* ULD markers */}
        {showUlds &&
          ulds.map((uld) => (
            <UldMarker
              key={uld.id}
              uld={uld}
              onClick={() => handleUldClick(uld)}
              selected={selectedUldId === uld.id}
            />
          ))}

        {/* Popup for details */}
        {popupInfo && (
          <Popup
            longitude={popupInfo.lngLat[0]}
            latitude={popupInfo.lngLat[1]}
            anchor="bottom"
            offset={25}
            closeButton={false}
            closeOnClick={false}
            className="operational-popup"
            style={{ zIndex: 1000 }}
          >
            <div className="p-3 min-w-[200px]">
              {popupInfo.type === "flight" && (
                <FlightPopupContent flight={popupInfo.data as FlightPosition} />
              )}
              {popupInfo.type === "uld" && (
                <UldPopupContent uld={popupInfo.data as ULDPosition} />
              )}
              {popupInfo.type === "airport" && (
                <AirportPopupContent airport={popupInfo.data as typeof landingSites[0]} />
              )}
            </div>
          </Popup>
        )}
      </Map>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur-sm rounded-xl border border-slate-200 p-3 shadow-lg text-xs">
        <p className="font-semibold text-slate-700 mb-2">Legend</p>
        <div className="space-y-1.5">
          {showFlights && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rotate-45" />
              <span className="text-slate-600">Active Flight</span>
            </div>
          )}
          {showUlds && (
            <>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-emerald-500 rounded-sm" />
                <span className="text-slate-600">Low Risk ULD</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-amber-500 rounded-sm" />
                <span className="text-slate-600">Medium Risk</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-orange-500 rounded-sm" />
                <span className="text-slate-600">High Risk</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-rose-500 rounded-sm" />
                <span className="text-slate-600">Critical</span>
              </div>
            </>
          )}
          {showAirports && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-600 rounded-full" />
              <span className="text-slate-600">Airport</span>
            </div>
          )}
        </div>
      </div>

      {/* Stats overlay */}
      <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-sm rounded-xl border border-slate-200 p-3 shadow-lg text-xs">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {showFlights && (
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-semibold text-blue-600">{flights.length}</span>
              <span className="text-slate-500">Flights</span>
            </div>
          )}
          {showUlds && (
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-semibold text-slate-700">{ulds.length}</span>
              <span className="text-slate-500">ULDs</span>
            </div>
          )}
          {alerts.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-semibold text-rose-600">{alerts.filter((a) => a.severity === "CRITICAL").length}</span>
              <span className="text-slate-500">Critical</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FlightPopupContent({ flight }: { flight: FlightPosition }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-bold text-slate-900">{flight.flightNumber}</span>
        <span
          className={cn(
            "px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase",
            flight.status === "DELAYED"
              ? "bg-amber-100 text-amber-700"
              : "bg-emerald-100 text-emerald-700"
          )}
        >
          {flight.status}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <span>{flight.origin}</span>
        <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
        <span>{flight.destination}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
        <div>
          <span className="text-slate-400">Altitude:</span>{" "}
          <span className="font-mono">{flight.altitude.toLocaleString()} ft</span>
        </div>
        <div>
          <span className="text-slate-400">Speed:</span>{" "}
          <span className="font-mono">{flight.speed} kts</span>
        </div>
        <div>
          <span className="text-slate-400">Aircraft:</span>{" "}
          <span className="font-mono">{flight.aircraftType}</span>
        </div>
        <div>
          <span className="text-slate-400">Delay:</span>{" "}
          <span className={cn("font-mono", flight.delay > 0 ? "text-amber-600" : "text-emerald-600")}>
            {flight.delay > 0 ? "+" : ""}
            {flight.delay} min
          </span>
        </div>
      </div>
    </div>
  );
}

function UldPopupContent({ uld }: { uld: ULDPosition }) {
  const riskColors = {
    LOW: "text-emerald-600",
    MEDIUM: "text-amber-600",
    HIGH: "text-orange-600",
    CRITICAL: "text-rose-600",
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-bold text-slate-900">{uld.id}</span>
        <span
          className={cn(
            "px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase",
            uld.riskLevel === "LOW" && "bg-emerald-100 text-emerald-700",
            uld.riskLevel === "MEDIUM" && "bg-amber-100 text-amber-700",
            uld.riskLevel === "HIGH" && "bg-orange-100 text-orange-700",
            uld.riskLevel === "CRITICAL" && "bg-rose-100 text-rose-700"
          )}
        >
          {uld.riskLevel}
        </span>
      </div>
      <div className="text-sm text-slate-600">
        <div className="text-slate-400 text-xs">Flight: {uld.flightNumber}</div>
        <div className="text-slate-400 text-xs">Location: {uld.airport} - {uld.zone}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
        <div>
          <span className="text-slate-400">Temp:</span>{" "}
          <span className={cn("font-mono font-semibold", uld.temperature > 8 ? "text-rose-600" : "text-slate-700")}>
            {uld.temperature.toFixed(1)}°C
          </span>
        </div>
        <div>
          <span className="text-slate-400">Humidity:</span>{" "}
          <span className="font-mono">{uld.humidity.toFixed(0)}%</span>
        </div>
        <div>
          <span className="text-slate-400">Battery:</span>{" "}
          <span className={cn("font-mono", uld.batteryLevel < 20 ? "text-rose-600" : "text-slate-700")}>
            {uld.batteryLevel.toFixed(0)}%
          </span>
        </div>
        <div>
          <span className="text-slate-400">Exposure:</span>{" "}
          <span className="font-mono">{uld.exposureScore}</span>
        </div>
      </div>
    </div>
  );
}

function AirportPopupContent({ airport }: { airport: typeof landingSites[0] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-bold text-slate-900">{airport.name}</span>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-blue-100 text-blue-700">
          {airport.iataCode}
        </span>
      </div>
      <div className="text-sm text-slate-600">
        <div className="text-slate-400 text-xs">ICAO: {airport.icaoCode}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
        <div>
          <span className="text-slate-400">Runway:</span>{" "}
          <span className="font-mono">{airport.runwayLength}m</span>
        </div>
        <div>
          <span className="text-slate-400">Status:</span>{" "}
          <span className={cn("font-mono font-semibold", airport.runwayStatus === "OPEN" ? "text-emerald-600" : "text-amber-600")}>
            {airport.runwayStatus}
          </span>
        </div>
        <div>
          <span className="text-slate-400">Cold Storage:</span>{" "}
          <span className={cn("font-mono", airport.coldStorageAvailable ? "text-emerald-600" : "text-slate-400")}>
            {airport.coldStorageAvailable ? `Yes (${airport.coldStorageTemp}°C)` : "No"}
          </span>
        </div>
        <div>
          <span className="text-slate-400">Cargo Team:</span>{" "}
          <span className={cn("font-mono", airport.cargoTeamReady ? "text-emerald-600" : "text-amber-600")}>
            {airport.cargoTeamReady ? "Ready" : "Not Ready"}
          </span>
        </div>
      </div>
      {airport.weather && (
        <div className="pt-2 border-t border-slate-200">
          <div className="text-xs text-slate-400 mb-1">Weather</div>
          <div className="grid grid-cols-2 gap-1 text-xs">
            <span>Temp: {airport.weather.temperature}°C</span>
            <span>Wind: {airport.weather.windSpeed}kt</span>
            <span>Vis: {airport.weather.visibility}km</span>
            <span>{airport.weather.conditions}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Add custom styles for the popup
const style = document.createElement("style");
style.textContent = `
  .operational-popup .maplibregl-popup-tip {
    border-top-color: white !important;
  }
  .operational-popup .maplibregl-popup-content {
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.15);
    border: 1px solid #e2e8f0;
    padding: 0;
  }
`;
document.head.appendChild(style);