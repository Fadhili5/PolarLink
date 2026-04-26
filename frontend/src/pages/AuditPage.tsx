import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { useAeroStore } from "../store/use-aero-store";
import { cn } from "../lib/utils";
import { ProductionGate, isProductionLegacyGateEnabled } from "../components/ui/ProductionGate";

export default function AuditPage() {
  if (isProductionLegacyGateEnabled()) {
    return (
      <ProductionGate
        title="Audit"
        description="Audit review must be backed by persisted audit logs and evidence records in production."
      />
    );
  }

  const { timeline, alerts, tasks, assistantMessages } = useAeroStore();

  const auditRows = [
    ...timeline.map((item) => ({
      id: `timeline-${item.id}`,
      type: item.type,
      detail: item.detail,
      timestamp: item.timestamp,
    })),
    ...alerts.map((item) => ({
      id: `alert-${item.id}`,
      type: "Alert",
      detail: item.title,
      timestamp: item.timestamp,
    })),
    ...tasks.map((item) => ({
      id: `task-${item.id}`,
      type: item.status,
      detail: `${item.action} • ${item.uldId}`,
      timestamp: item.dueAt,
    })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 24);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Operational Audit Trail</CardTitle>
            <CardDescription>Forensic trace across events, interventions, acknowledgements, and recovery state changes.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {auditRows.map((row) => (
            <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-sm text-slate-900">{row.type}</strong>
                <span className="text-[11px] text-slate-500">{new Date(row.timestamp).toLocaleString()}</span>
              </div>
              <p className="mt-2 text-xs text-slate-700">{row.detail}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Audit Scope</CardTitle>
              <CardDescription>What should be independently reviewable in the platform.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {["Telemetry", "Exposure", "Custody", "Alerts", "Interventions", "Verification", "Replay Evidence", "AI Reasoning"].map((item) => (
              <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                {item}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>AI Review Trail</CardTitle>
              <CardDescription>Operator and assistant exchange history that influenced decisions.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {assistantMessages.slice(-4).map((message) => (
              <div
                key={message.id}
                className={cn(
                  "rounded-2xl border p-3 text-sm",
                  message.role === "assistant" ? "border-blue-200 bg-blue-50/70 text-slate-800" : "border-slate-200 bg-slate-50 text-slate-700",
                )}
              >
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {message.role === "assistant" ? "AI Ops" : "Operator"}
                </p>
                <p>{message.text}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
