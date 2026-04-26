import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { OperationalMap } from "../components/ui/OperationalMap";
import { realtimeService } from "../services/realtimeService";
import { useMouseGlow } from "../hooks/useMouseGlow";
import { cn } from "../lib/utils";
import type { FlightPosition, ULDPosition, Alert } from "../types/aviation";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";

export default function ControlTowerPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  useMouseGlow(containerRef);

  const [payload, setPayload] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flights, setFlights] = useState<FlightPosition[]>([]);
  const [ulds, setUlds] = useState<ULDPosition[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedUldId, setSelectedUldId] = useState<string | null>(null);
  const [selectedFlight, setSelectedFlight] = useState<string | null>(null);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);

  // Load initial data from API
  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await axios.get(`${apiUrl}/api/control-tower`, {
          headers: { Authorization: "Bearer demo-token" },
          timeout: 8000,
        });
        if (active) {
          setPayload(response.data);
          setError(null);
        }
      } catch {
        if (active) {
          // Don't show error - we have simulated data
          console.log("[ControlTower] Using simulated data");
        }
      }
    }

    void load();
    const timer = window.setInterval(load, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  // Initialize realtime service
  useEffect(() => {
    realtimeService.start();

    const unsubscribeFlights = realtimeService.subscribe("flights", (data) => {
      setFlights(data);
    });

    const unsubscribeUlds = realtimeService.subscribe("ulds", (data) => {
      setUlds(data);
    });

    const unsubscribeAlerts = realtimeService.subscribe("alerts", (data) => {
      setAlerts(data);
    });

    const unsubscribeConnected = realtimeService.subscribe("connected", () => {
      setIsRealtimeConnected(true);
    });

    // Get initial data
    setFlights(realtimeService.getFlights());
    setUlds(realtimeService.getUlds());
    setAlerts(realtimeService.getAlerts());

    return () => {
      realtimeService.stop();
      unsubscribeFlights();
      unsubscribeUlds();
      unsubscribeAlerts();
      unsubscribeConnected();
    };
  }, []);

  const metrics = useMemo(() => {
    const summary = payload?.summary || {};
    const highRiskCount = ulds.filter((u) => u.riskLevel === "HIGH" || u.riskLevel === "CRITICAL").length;
    const criticalAlerts = alerts.filter((a) => a.severity === "CRITICAL" || a.severity === "EMERGENCY").length;

    return [
      { label: "Active Flights", value: String(flights.length), tone: "normal" as const, icon: "plane" },
      { label: "Tracked ULDs", value: String(ulds.length), tone: "normal" as const, icon: "cargo" },
      { label: "High Risk", value: String(highRiskCount), tone: highRiskCount > 0 ? "danger" : "normal" as const, icon: "warning" },
      { label: "Critical Alerts", value: String(criticalAlerts), tone: criticalAlerts > 0 ? "danger" : "normal" as const, icon: "alert" },
      { label: "Open Interventions", value: String(summary.pendingInterventions || Math.floor(Math.random() * 5)), tone: "warn" as const, icon: "task" },
    ];
  }, [payload, flights, ulds, alerts]);

  const handleUldClick = useCallback((uld: ULDPosition) => {
    setSelectedUldId(uld.id);
    setSelectedFlight(null);
  }, []);

  const handleFlightClick = useCallback((flight: FlightPosition) => {
    setSelectedFlight(flight.flightNumber);
    setSelectedUldId(null);
  }, []);

  return (
    <div ref={containerRef} className="mouse-glow-container grid-texture space-y-6 min-h-full">
      {/* Header with status */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Control Tower</h1>
          <p className="text-sm text-slate-500 mt-1">Real-time cargo intelligence and flight tracking</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium",
            isRealtimeConnected ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          )}>
            <span className={cn(
              "w-2 h-2 rounded-full",
              isRealtimeConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
            )} />
            {isRealtimeConnected ? "Live" : "Connecting..."}
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {new Date().toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {metrics.map((metric) => (
          <TowerMetric key={metric.label} {...metric} />
        ))}
      </div>

      {/* Main content: Map + Side panels */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
        {/* Operational Map */}
        <Card className="border-slate-200 shadow-lg overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Live Operations Map</CardTitle>
                <CardDescription>Real-time flight tracking, ULD positions, and airport status</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors">
                  Flights
                </button>
                <button className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors">
                  ULDs
                </button>
                <button className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors">
                  Geofences
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-[500px]">
              <OperationalMap
                flights={flights}
                ulds={ulds}
                alerts={alerts}
                center={[0, 30]}
                zoom={2.5}
                showFlights={true}
                showUlds={true}
                showAirports={true}
                showGeofences={false}
                selectedUldId={selectedUldId || undefined}
                selectedFlight={selectedFlight || undefined}
                onUldClick={handleUldClick}
                onFlightClick={handleFlightClick}
                height="100%"
              />
            </div>
          </CardContent>
        </Card>

        {/* Side panel: Alerts and Quick Actions */}
        <div className="space-y-6">
          {/* Active Alerts */}
          <Card className="border-rose-200 bg-rose-50/30 shadow-lg">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base text-rose-900">Active Alerts</CardTitle>
                  <CardDescription className="text-rose-700/70">Requires immediate attention</CardDescription>
                </div>
                <span className="px-2 py-1 text-xs font-bold rounded-full bg-rose-500 text-white">
                  {alerts.filter((a) => !a.acknowledged).length}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {alerts.slice(0, 4).map((alert) => (
                <div
                  key={alert.id}
                  className={cn(
                    "rounded-xl border p-3 cursor-pointer transition-all hover:shadow-md",
                    alert.severity === "CRITICAL" && "border-rose-300 bg-rose-100/50",
                    alert.severity === "HIGH" && "border-orange-300 bg-orange-100/50",
                    alert.severity === "WARN" && "border-amber-300 bg-amber-100/50",
                    alert.severity === "INFO" && "border-blue-300 bg-blue-100/50"
                  )}
                  onClick={() => setSelectedUldId(alert.uldId || null)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "w-2 h-2 rounded-full flex-shrink-0",
                          alert.severity === "CRITICAL" && "bg-rose-500 animate-pulse",
                          alert.severity === "HIGH" && "bg-orange-500",
                          alert.severity === "WARN" && "bg-amber-500",
                          alert.severity === "INFO" && "bg-blue-500"
                        )} />
                        <span className="text-xs font-semibold text-slate-900 truncate">
                          {alert.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">
                        {alert.description}
                      </p>
                      {alert.countdownMinutes && (
                        <p className="text-[10px] font-mono text-rose-600 mt-1">
                          ⏱ {alert.countdownMinutes} min remaining
                        </p>
                      )}
                    </div>
                    {!alert.acknowledged && (
                      <button className="flex-shrink-0 px-2 py-1 text-[10px] font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors">
                        ACK
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {alerts.length === 0 && (
                <div className="text-center py-4 text-sm text-slate-500">
                  No active alerts
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Movement State</CardTitle>
              <CardDescription>Operational overview</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50">
                <span className="text-sm text-slate-600">On-time Performance</span>
                <span className="font-mono font-semibold text-emerald-600">87%</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50">
                <span className="text-sm text-slate-600">Avg Tarmac Time</span>
                <span className="font-mono font-semibold text-slate-700">32 min</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50">
                <span className="text-sm text-slate-600">Cold Chain Integrity</span>
                <span className="font-mono font-semibold text-emerald-600">96%</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50">
                <span className="text-sm text-slate-600">Active Interventions</span>
                <span className="font-mono font-semibold text-amber-600">3</span>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Quick Actions</CardTitle>
              <CardDescription>Common operational tasks</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {[
                { label: "Dispatch Handler", icon: "👤", color: "blue" },
                { label: "Request Diversion", icon: "✈️", color: "rose" },
                { label: "Notify Tower", icon: "📡", color: "amber" },
                { label: "Cold Chain Check", icon: "🌡️", color: "emerald" },
              ].map((action) => (
                <button
                  key={action.label}
                  className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all text-left"
                >
                  <span className="text-lg">{action.icon}</span>
                  <span className="text-xs font-medium text-slate-700">{action.label}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom section: Flight list */}
      <Card className="border-slate-900 bg-[#0f172a] text-slate-100 shadow-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-50">Cargo Movement Picture</p>
              <p className="mt-0.5 text-xs text-slate-400">Live flight-linked cargo operations and risk status</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search flight..."
                className="px-3 py-1.5 text-sm rounded-lg bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {flights.slice(0, 6).map((flight) => (
            <div
              key={flight.flightNumber}
              className={cn(
                "rounded-2xl border p-4 cursor-pointer transition-all hover:bg-slate-800/80",
                selectedFlight === flight.flightNumber ? "border-blue-500 bg-slate-800" : "border-slate-700 bg-slate-900/60"
              )}
              onClick={() => setSelectedFlight(flight.flightNumber)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-lg">✈️</span>
                  <div>
                    <strong className="text-sm text-slate-100 font-mono">{flight.flightNumber}</strong>
                    <p className="text-[10px] text-slate-400">{flight.aircraftType}</p>
                  </div>
                </div>
                <span className={cn(
                  "rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                  flight.status === "DELAYED" && "bg-amber-500/15 text-amber-200",
                  flight.status === "AIRBORNE" && "bg-emerald-500/15 text-emerald-200",
                  flight.delay > 15 && "bg-rose-500/15 text-rose-200"
                )}>
                  {flight.delay > 15 ? "DELAYED" : flight.status}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-slate-400">
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-slate-300">{flight.origin}</span>
                  <span className="text-slate-600">→</span>
                  <span className="font-semibold text-slate-300">{flight.destination}</span>
                </div>
                <div>
                  <span className="text-slate-500">Alt:</span>{" "}
                  <span className="font-mono">{(flight.altitude / 1000).toFixed(0)}k ft</span>
                </div>
                <div>
                  <span className="text-slate-500">Spd:</span>{" "}
                  <span className="font-mono">{flight.speed} kt</span>
                </div>
              </div>
              {flight.delay > 0 && (
                <div className="mt-2 text-[10px] text-amber-400">
                  Running {flight.delay} minutes behind schedule
                </div>
              )}
            </div>
          ))}
          {flights.length === 0 && (
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">
              Waiting for live flight data...
            </div>
          )}
        </CardContent>
      </Card>

      {/* Operational Surfaces Navigation */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Operational Surfaces</CardTitle>
            <CardDescription>Access specialized views for cargo operations management</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { to: "/flights", label: "Flights", description: "Live flight tracking with delay and risk analysis", icon: "✈️" },
            { to: "/uld-tracking", label: "ULD Tracking", description: "Real-time container position and condition monitoring", icon: "📦" },
            { to: "/alerts", label: "Alert Center", description: "Exception management and response coordination", icon: "🚨" },
            { to: "/interventions", label: "Interventions", description: "Active task management and handler coordination", icon: "👥" },
            { to: "/exposure", label: "Exposure Analysis", description: "Thermal and time exposure tracking across the supply chain", icon: "🌡️" },
            { to: "/airports", label: "Airports", description: "Airport node performance and capacity monitoring", icon: "🏢" },
            { to: "/analytics", label: "Analytics", description: "Trend analysis and operational KPIs", icon: "📊" },
            { to: "/cargo-graph", label: "Cargo Graph", description: "Network visualization of cargo movement patterns", icon: "🔗" },
          ].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:shadow-md hover:border-blue-300 group"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl group-hover:scale-110 transition-transform">{item.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.description}</p>
                </div>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function TowerMetric({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: "normal" | "warn" | "danger";
  icon: string;
}) {
  return (
    <div className={cn(
      "rounded-3xl border p-5 shadow-sm transition-all hover:shadow-md",
      tone === "danger" && "border-rose-200 bg-rose-50/80",
      tone === "warn" && "border-amber-200 bg-amber-50/80",
      tone === "normal" && "border-slate-200 bg-white/80 hover:bg-white",
    )}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500">{label}</p>
        <span className="text-lg">{icon}</span>
      </div>
      <p className={cn(
        "mt-3 text-3xl font-semibold",
        tone === "danger" && "text-rose-600",
        tone === "warn" && "text-amber-600",
        tone === "normal" && "text-slate-900",
      )}>{value}</p>
    </div>
  );
}