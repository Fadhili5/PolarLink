import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { authHeader } from "../lib/aero-control";
import { cn } from "../lib/utils";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";

type EventFilter = "ALL" | "ALERT" | "INTERVENTION" | "WORKFLOW" | "CUSTODY";

export default function LiveEventsPage() {
  const [filter, setFilter] = useState<EventFilter>("ALL");
  const [payload, setPayload] = useState<any | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await axios.get(`${apiUrl}/api/live-events`, {
          headers: authHeader(),
          timeout: 8000,
        });
        if (active) {
          setPayload(response.data);
        }
      } catch {
        if (active) {
          setPayload(null);
        }
      }
    }

    void load();
    const timer = window.setInterval(load, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const events = useMemo(() => {
    const merged = payload?.events || [];
    return filter === "ALL" ? merged : merged.filter((item: any) => item.category === filter);
  }, [filter, payload]);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.45fr_1fr]">
      <Card className="border-slate-900 bg-[#0f172a] text-slate-100 shadow-xl">
        <CardHeader>
          <div>
            <p className="text-sm font-semibold text-slate-50">Event-Native Cargo Feed</p>
            <p className="mt-0.5 text-xs text-slate-400">Operational changes, alerts, acknowledgements, workflows, and custody transitions in one live stream.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["ALL", "ALERT", "INTERVENTION", "WORKFLOW", "CUSTODY"] as const).map((level) => (
              <button
                key={level}
                onClick={() => setFilter(level)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                  filter === level
                    ? "border-blue-400 bg-blue-500/15 text-blue-100"
                    : "border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800",
                )}
              >
                {level}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 font-mono text-xs">
          {events.length === 0 ? (
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-3 text-slate-300">
              Waiting for live events.
            </div>
          ) : (
            events.slice(0, 30).map((event: any) => (
              <div
                key={event.id}
                className={cn(
                  "rounded-xl border px-3 py-3",
                  toneFor(event) === "danger" && "border-rose-500/30 bg-rose-500/10 text-rose-100",
                  toneFor(event) === "warn" && "border-amber-500/30 bg-amber-500/10 text-amber-100",
                  toneFor(event) === "normal" && "border-slate-700 bg-slate-900/60 text-slate-200",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <strong>{event.category} • {event.title}</strong>
                  <span className="text-[10px] text-slate-400">{new Date(event.timestamp).toLocaleTimeString()}</span>
                </div>
                <p className="mt-1 text-slate-300">{event.detail}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Execution Pulse</CardTitle>
            <CardDescription>How the event stream is translating into coordinated action.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <EventMetric label="Live Alerts" value={String(payload?.summary?.alerts || 0)} />
          <EventMetric label="Pending Interventions" value={String(payload?.summary?.interventions || 0)} />
          <EventMetric label="Active Workflows" value={String(payload?.summary?.workflows || 0)} />
          <EventMetric label="Custody Events" value={String(payload?.summary?.custodyEvents || 0)} />
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            This surface is fed by platform events instead of static cards, so alerts, workflows, and cargo handling transitions stay in one operational chronology.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EventMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function toneFor(event: any) {
  const severity = String(event?.severity || "").toUpperCase();
  if (severity.includes("HIGH") || severity.includes("CRITICAL") || severity.includes("BREACH")) {
    return "danger";
  }
  if (severity.includes("MEDIUM") || severity.includes("WARNING") || severity.includes("WATCH")) {
    return "warn";
  }
  return "normal";
}
