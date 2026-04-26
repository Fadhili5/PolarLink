import { useEffect, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { authHeader } from "../lib/aero-control";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";
const socketUrl = import.meta.env.VITE_SOCKET_URL || "http://localhost:3000";

type Shipment = {
  cargoId: string;
  flight: string;
  currentLocation: string;
  currentZone: string;
  currentCustodian: string;
  currentTeam: string;
  currentStatus: string;
  removedReason: string;
  outsideCustodyMinutes: number;
  returnedToManifest: boolean;
  chainBroken: boolean;
  integrityScore: number;
  stopLoad: boolean;
  riskScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  incidentSeverity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  theftRisk: number;
  tamperRisk: number;
  recommendedIntervention: string;
  riskFactors: string[];
  lastUpdatedAt: string;
  touchedBy: string[];
};

type CustodyControlResponse = {
  summary: {
    trackedCargo: number;
    chainBrokenCount: number;
    stopLoadCount: number;
    missingCount: number;
    tamperCount: number;
  };
  shipments: Shipment[];
  highRisk: Shipment[];
};

type TimelineEvent = {
  id: string;
  action: string;
  timestamp: string;
  location: string;
  handler: string;
  team: string;
  durationOutsideCustodyMinutes: number;
  condition: string;
  sealId: string;
  riskScore: number;
  integrityScore: number;
  video: string | null;
};

type CustodySummary = {
  cargoId: string;
  flight: string;
  currentLocation: string;
  currentStatus: string;
  currentCustodian: string;
  currentTeam: string;
  removedReason: string;
  outsideCustodyMinutes: number;
  returnedToManifest: boolean;
  chainBroken: boolean;
  cargoIntegrityScore: number;
  stopLoad: boolean;
  touchedBy: string[];
  manifestVerified: boolean;
  evidenceTrail: { timestamp: string; action: string; video: string | null; photo: string | null }[];
  timeline: TimelineEvent[];
};

type RiskSummary = {
  cargoId: string;
  riskScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  incidentSeverity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  theftRisk: number;
  tamperRisk: number;
  chainBroken: boolean;
  stopLoad: boolean;
  recommendedIntervention: string;
  riskFactors: string[];
  cargoIntegrityScore: number;
};

type LocationSummary = {
  cargoId: string;
  currentLocation: string;
  currentZone: string;
  currentCustodian: string;
  vehicleTransfer: string;
  lastUpdatedAt: string;
  movementReplay: { timestamp: string; location: string; zone: string; action: string }[];
};

type VideoSummary = {
  cargoId: string;
  evidence: {
    eventId: string;
    timestamp: string;
    location: string;
    action: string;
    replayAvailable: boolean;
    replayUrl: string;
    condition: string;
    sealId: string;
    anomalies: { atSecond: number; label: string; severity: string }[];
  }[];
};

type ReplaySummary = {
  cargoId: string;
  eventId: string;
  timestamp: string;
  location: string;
  action: string;
  condition: string;
  sealId: string;
  durationSeconds: number;
  anomalies: { atSecond: number; label: string; severity: string }[];
  keyframes: { index: number; atSecond: number; caption: string; frameUrl: string }[];
};

type FeedItem = {
  id: string;
  timestamp: string;
  headline: string;
  tone: "normal" | "warn" | "danger";
};

export default function CargoCustodyPage() {
  const [control, setControl] = useState<CustodyControlResponse | null>(null);
  const [selectedCargoId, setSelectedCargoId] = useState<string>("AWB-78492");
  const [custody, setCustody] = useState<CustodySummary | null>(null);
  const [risk, setRisk] = useState<RiskSummary | null>(null);
  const [location, setLocation] = useState<LocationSummary | null>(null);
  const [video, setVideo] = useState<VideoSummary | null>(null);
  const [replay, setReplay] = useState<ReplaySummary | null>(null);
  const [activeReplayFrame, setActiveReplayFrame] = useState(0);
  const [playbackSecond, setPlaybackSecond] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [copilotPrompt, setCopilotPrompt] = useState("Why was AWB-78492 removed?");
  const [copilotResponse, setCopilotResponse] = useState("CargoOps Agent ready for forensic search.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!selectedCargoId) return;
    void loadShipment(selectedCargoId);
  }, [selectedCargoId]);

  useEffect(() => {
    if (!replay || !isPlaying) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setPlaybackSecond((current) => {
        const next = current + 1;
        if (next >= replay.durationSeconds) {
          setIsPlaying(false);
          return replay.durationSeconds;
        }
        const nextFrame = replay.keyframes.reduce(
          (closest, frame, index) =>
            Math.abs(frame.atSecond - next) < Math.abs(replay.keyframes[closest].atSecond - next)
              ? index
              : closest,
          0,
        );
        setActiveReplayFrame(nextFrame);
        return next;
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [replay, isPlaying]);

  useEffect(() => {
    const socket = io(socketUrl, {
      autoConnect: true,
      path: "/socket.io",
      transports: ["polling", "websocket"],
      timeout: 10000,
    });

    socket.on("cargo-event", (payload) => {
      const headline = `${payload.event.action} • ${payload.cargoId} • ${payload.event.location}`;
      setFeed((current) => [
        createFeedItem(
          payload.event.timestamp,
          headline,
          payload.state.chainBroken ? "danger" : payload.state.riskLevel === "HIGH" ? "warn" : "normal",
        ),
        ...current,
      ].slice(0, 40));

      void bootstrap();
      if (payload.cargoId === selectedCargoId) {
        void loadShipment(selectedCargoId);
      }
    });

    socket.on("cargo-incident", (incident) => {
      setFeed((current) => [
        createFeedItem(
          incident.timestamp,
          `INCIDENT ${incident.severity} • ${incident.cargoId} • ${incident.message}`,
          "danger",
        ),
        ...current,
      ].slice(0, 40));
    });

    return () => {
      socket.disconnect();
    };
  }, [selectedCargoId]);

  async function bootstrap() {
    const response = await axios.get(`${apiUrl}/api/cargo/control-center`, {
      headers: authHeader(),
      timeout: 8000,
    });
    const payload = response.data as CustodyControlResponse;
    setControl(payload);
    if (!selectedCargoId && payload.shipments[0]?.cargoId) {
      setSelectedCargoId(payload.shipments[0].cargoId);
    }
    if (!feed.length) {
      setFeed(
        payload.shipments.slice(0, 6).map((shipment) =>
          createFeedItem(
            shipment.lastUpdatedAt,
            `${shipment.cargoId} • ${shipment.currentStatus} • ${shipment.currentLocation}`,
            shipment.chainBroken ? "danger" : shipment.riskLevel === "HIGH" ? "warn" : "normal",
          ),
        ),
      );
    }
  }

  async function loadShipment(cargoId: string) {
    const [custodyResponse, riskResponse, locationResponse, videoResponse] = await Promise.all([
      axios.get(`${apiUrl}/api/cargo/chain-of-custody/${cargoId}`, { headers: authHeader(), timeout: 8000 }),
      axios.get(`${apiUrl}/api/cargo/risk/${cargoId}`, { headers: authHeader(), timeout: 8000 }),
      axios.get(`${apiUrl}/api/cargo/location/${cargoId}`, { headers: authHeader(), timeout: 8000 }),
      axios.get(`${apiUrl}/api/cargo/video/${cargoId}`, { headers: authHeader(), timeout: 8000 }),
    ]);

    setCustody(custodyResponse.data);
    setRisk(riskResponse.data);
    setLocation(locationResponse.data);
    setVideo(videoResponse.data);
    setReplay(null);
    setActiveReplayFrame(0);
    setPlaybackSecond(0);
    setIsPlaying(false);
  }

  async function submitAction(endpoint: "scan-out" | "scan-in" | "reload") {
    if (!custody || busy) return;
    setBusy(true);
    try {
      await axios.post(
        `${apiUrl}/api/cargo/${endpoint}`,
        {
          cargo_id: custody.cargoId,
          flight: custody.flight,
          location: endpoint === "reload" ? "Aircraft Hold / Position 14" : custody.currentLocation,
          handler: endpoint === "reload" ? "ops-supervisor-7" : custody.currentCustodian,
          team: endpoint === "reload" ? "airline_ops" : custody.currentTeam,
          reason:
            endpoint === "scan-out"
              ? "Security Re-check"
              : endpoint === "scan-in"
                ? "Returned To Secured Custody"
                : "Manifest Reload Validation",
          condition: "sealed",
          seal_id: custody.timeline[custody.timeline.length - 1]?.sealId || "SEAL-10024",
          weight: "424kg",
          temperature: "4C",
          barcode_scan: custody.cargoId,
          rfid_scan: `RFID-${custody.cargoId.split("-")[1]}`,
          biometric_verified: true,
          video_clip: null,
          photo_evidence: null,
          signature: `digital:${custody.currentCustodian}`,
        },
        {
          headers: authHeader(),
          timeout: 8000,
        },
      );
      await bootstrap();
      await loadShipment(custody.cargoId);
    } finally {
      setBusy(false);
    }
  }

  async function askCopilot() {
    if (!copilotPrompt.trim()) return;
    setBusy(true);
    try {
      const response = await axios.post(
        `${apiUrl}/api/cargo/copilot/query`,
        { prompt: copilotPrompt },
        { headers: authHeader(), timeout: 8000 },
      );
      setCopilotResponse(response.data.answer);
    } finally {
      setBusy(false);
    }
  }

  async function loadReplay(eventId: string) {
    const response = await axios.get(`${apiUrl}/api/cargo/video/${selectedCargoId}/${eventId}/replay`, {
      headers: authHeader(),
      timeout: 8000,
    });
    const payload = response.data as ReplaySummary;
    setReplay(payload);
    setActiveReplayFrame(0);
    setPlaybackSecond(0);
    setIsPlaying(false);
  }

  function scrubReplay(nextSecond: number) {
    if (!replay) return;
    const bounded = Math.max(0, Math.min(nextSecond, replay.durationSeconds));
    setPlaybackSecond(bounded);
    const nextFrame = replay.keyframes.reduce(
      (closest, frame, index) =>
        Math.abs(frame.atSecond - bounded) < Math.abs(replay.keyframes[closest].atSecond - bounded)
          ? index
          : closest,
      0,
    );
    setActiveReplayFrame(nextFrame);
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <MetricCard label="Tracked Cargo" value={String(control?.summary.trackedCargo ?? 0)} tone="normal" />
        <MetricCard label="Broken Chains" value={String(control?.summary.chainBrokenCount ?? 0)} tone="danger" />
        <MetricCard label="Stop Load" value={String(control?.summary.stopLoadCount ?? 0)} tone="danger" />
        <MetricCard label="Missing" value={String(control?.summary.missingCount ?? 0)} tone="warn" />
        <MetricCard label="Tamper Alerts" value={String(control?.summary.tamperCount ?? 0)} tone="warn" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1.4fr_1fr]">
        <Card className="border-slate-200 bg-white/80">
          <CardHeader>
            <CardTitle>Tracked Shipments</CardTitle>
            <CardDescription>Instant answer to where cargo is, who touched it, and whether custody is intact.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(control?.shipments || []).map((shipment) => (
              <button
                key={shipment.cargoId}
                onClick={() => setSelectedCargoId(shipment.cargoId)}
                className={cn(
                  "w-full rounded-2xl border p-4 text-left transition-all",
                  selectedCargoId === shipment.cargoId
                    ? "border-blue-200 bg-blue-50/80 shadow-sm"
                    : "border-slate-200 bg-slate-50 hover:bg-white",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{shipment.cargoId}</p>
                    <p className="mt-1 text-xs text-slate-500">{shipment.flight} • {shipment.currentLocation}</p>
                  </div>
                  <span className={badgeTone(shipment.chainBroken ? "danger" : shipment.riskLevel === "HIGH" ? "warn" : "normal")}>
                    {shipment.currentStatus}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                  <span>Custodian: {shipment.currentCustodian}</span>
                  <span>Team: {shipment.currentTeam}</span>
                  <span>Outside custody: {shipment.outsideCustodyMinutes}m</span>
                  <span>Integrity: {shipment.integrityScore}</span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-900 bg-[#0f172a] text-slate-100 shadow-xl">
          <CardHeader>
            <div>
              <p className="text-sm font-semibold text-slate-50">Forensic Activity Feed</p>
              <p className="mt-0.5 text-xs text-slate-400">Bloomberg-terminal style custody ticker with live exceptions and movement transitions.</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 font-mono text-xs">
            {feed.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "rounded-xl border px-3 py-2",
                  item.tone === "danger" && "border-rose-500/40 bg-rose-500/10 text-rose-100",
                  item.tone === "warn" && "border-amber-500/30 bg-amber-500/10 text-amber-100",
                  item.tone === "normal" && "border-slate-700 bg-slate-900/60 text-slate-200",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span>{item.headline}</span>
                  <span className="text-[10px] text-slate-400">{formatTime(item.timestamp)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white/80">
          <CardHeader>
            <CardTitle>CargoOps Agent</CardTitle>
            <CardDescription>Natural-language forensic search across movement, custody breaks, and reload integrity.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              value={copilotPrompt}
              onChange={(event) => setCopilotPrompt(event.target.value)}
              className="min-h-[110px] w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
            <Button className="w-full" onClick={() => void askCopilot()} disabled={busy}>
              Ask CargoOps Agent
            </Button>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              {copilotResponse}
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Button variant="outline" onClick={() => setCopilotPrompt(`Why was ${selectedCargoId} removed?`)}>Why removed?</Button>
              <Button variant="outline" onClick={() => setCopilotPrompt("Show all cargo with broken custody chain.")}>Broken chains</Button>
              <Button variant="outline" onClick={() => setCopilotPrompt("Which shipment has highest theft risk?")}>Highest theft risk</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card className="border-slate-200 bg-white/80">
          <CardHeader>
            <CardTitle>Chain-of-Custody Timeline</CardTitle>
            <CardDescription>
              {custody ? `${custody.cargoId} • ${custody.currentLocation} • ${custody.currentStatus}` : "Select a shipment to inspect the custody trail."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(custody?.timeline || []).map((event) => (
              <div key={event.id} className="grid grid-cols-[auto_1fr_auto] gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mt-1 h-2.5 w-2.5 rounded-full bg-blue-500" />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{event.action}</p>
                    <span className={badgeTone(event.integrityScore < 70 ? "danger" : event.riskScore >= 70 ? "warn" : "normal")}>
                      integrity {Math.round(event.integrityScore)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{event.location} • {event.handler} • {event.team}</p>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-600">
                    <span>Outside custody: {event.durationOutsideCustodyMinutes}m</span>
                    <span>Condition: {event.condition}</span>
                    <span>Seal: {event.sealId}</span>
                    <span>Risk: {Math.round(event.riskScore)}</span>
                  </div>
                </div>
                <div className="text-right text-[11px] text-slate-500">
                  <div>{formatDate(event.timestamp)}</div>
                  {event.video && (
                    <a className="mt-2 inline-block text-blue-600 underline" href={event.video} target="_blank" rel="noreferrer">
                      Replay
                    </a>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-slate-200 bg-white/80">
            <CardHeader>
              <CardTitle>Integrity & Risk</CardTitle>
              <CardDescription>Smart reload validation, theft/tamper scoring, and operational stop-load gating.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <SmallStat label="Integrity" value={String(risk?.cargoIntegrityScore ?? 0)} />
                <SmallStat label="Risk" value={String(risk?.riskScore ?? 0)} />
                <SmallStat label="Theft" value={String(risk?.theftRisk ?? 0)} />
                <SmallStat label="Tamper" value={String(risk?.tamperRisk ?? 0)} />
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                {risk?.recommendedIntervention || "Awaiting shipment selection."}
              </div>
              <div className="flex flex-wrap gap-2">
                {(risk?.riskFactors || []).map((factor) => (
                  <span key={factor} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-700">
                    {factor.split("_").join(" ")}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-2">
                <Button onClick={() => void submitAction("scan-out")} disabled={busy}>Record Scan Out</Button>
                <Button variant="outline" onClick={() => void submitAction("scan-in")} disabled={busy}>Record Scan In</Button>
                <Button
                  variant={risk?.stopLoad ? "danger" : "default"}
                  onClick={() => void submitAction("reload")}
                  disabled={busy}
                >
                  {risk?.stopLoad ? "Supervisor Override Required" : "Validate Reload"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white/80">
            <CardHeader>
              <CardTitle>Indoor Position Replay</CardTitle>
              <CardDescription>Warehouse, customs, bonded, truck dock, and aircraft transfer path.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">{location?.currentLocation || "No location selected"}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {location?.currentZone || "Zone unknown"} • {location?.currentCustodian || "Custodian unknown"} • {location?.vehicleTransfer || "Carrier unknown"}
                </p>
              </div>
              {(location?.movementReplay || []).slice(-6).reverse().map((entry) => (
                <div key={`${entry.timestamp}-${entry.location}`} className="rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
                  <div className="flex items-center justify-between gap-3">
                    <strong>{entry.action}</strong>
                    <span className="text-slate-500">{formatTime(entry.timestamp)}</span>
                  </div>
                  <p className="mt-1">{entry.location} • {entry.zone}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white/80">
            <CardHeader>
              <CardTitle>Camera Replay</CardTitle>
              <CardDescription>Dedicated anomaly replay with frame scrubbing, AI overlays, and operator playback controls.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {replay && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-900">
                    <img
                      src={`${apiUrl}${replay.keyframes[activeReplayFrame]?.frameUrl || ""}`}
                      alt={`${replay.action} replay frame`}
                      className="h-auto w-full"
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button onClick={() => setIsPlaying((current) => !current)}>
                      {isPlaying ? "Pause Replay" : "Play Replay"}
                    </Button>
                    <Button variant="outline" onClick={() => scrubReplay(Math.max(0, playbackSecond - 5))}>
                      -5s
                    </Button>
                    <Button variant="outline" onClick={() => scrubReplay(Math.min(replay.durationSeconds, playbackSecond + 5))}>
                      +5s
                    </Button>
                    <span className="text-xs text-slate-500">
                      {playbackSecond}s / {replay.durationSeconds}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={replay.durationSeconds}
                    value={playbackSecond}
                    onChange={(event) => scrubReplay(Number(event.target.value))}
                    className="mt-4 w-full"
                  />
                  <div className="mt-4 grid grid-cols-1 gap-2">
                    {replay.anomalies.map((anomaly) => (
                      <button
                        key={`${anomaly.atSecond}-${anomaly.label}`}
                        onClick={() => scrubReplay(anomaly.atSecond)}
                        className={cn(
                          "rounded-xl border px-3 py-2 text-left text-xs",
                          anomaly.severity === "CRITICAL" && "border-rose-200 bg-rose-50 text-rose-700",
                          anomaly.severity === "HIGH" && "border-amber-200 bg-amber-50 text-amber-700",
                          anomaly.severity !== "CRITICAL" && anomaly.severity !== "HIGH" && "border-slate-200 bg-white text-slate-700",
                        )}
                      >
                        {anomaly.atSecond}s • {anomaly.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(video?.evidence || []).slice(0, 4).map((entry) => (
                <div key={entry.eventId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">{entry.action}</p>
                    <span className="text-[11px] text-slate-500">{formatTime(entry.timestamp)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{entry.location} • seal {entry.sealId} • {entry.condition}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => void loadReplay(entry.eventId)}>
                      Open Replay
                    </Button>
                    {entry.anomalies.slice(0, 2).map((anomaly) => (
                      <span key={`${entry.eventId}-${anomaly.atSecond}`} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-700">
                        {anomaly.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: "normal" | "warn" | "danger" }) {
  return (
    <div className={cn(
      "rounded-3xl border p-5 shadow-sm",
      tone === "danger" && "border-rose-200 bg-rose-50/80",
      tone === "warn" && "border-amber-200 bg-amber-50/80",
      tone === "normal" && "border-slate-200 bg-white/80",
    )}>
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function createFeedItem(timestamp: string, headline: string, tone: FeedItem["tone"]): FeedItem {
  return {
    id: crypto.randomUUID(),
    timestamp,
    headline,
    tone,
  };
}

function badgeTone(tone: "normal" | "warn" | "danger") {
  return cn(
    "rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
    tone === "danger" && "bg-rose-100 text-rose-700",
    tone === "warn" && "bg-amber-100 text-amber-700",
    tone === "normal" && "bg-emerald-100 text-emerald-700",
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
