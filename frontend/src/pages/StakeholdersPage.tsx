import { useEffect, useState } from "react";
import axios from "axios";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { authHeader } from "../lib/aero-control";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";

export default function StakeholdersPage() {
  const [payload, setPayload] = useState<any | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await axios.get(`${apiUrl}/api/stakeholders`, {
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
    const timer = window.setInterval(load, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const stakeholders = payload?.stakeholders || [];

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_1fr]">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Multi-Party Execution</CardTitle>
            <CardDescription>Shared operational execution layer across handlers, warehouse, airline, customs, and downstream stakeholders.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {stakeholders.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Waiting for live stakeholder execution data.
            </div>
          ) : (
            stakeholders.map((stakeholder: any) => (
              <div key={stakeholder.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm text-slate-900">{stakeholder.name}</strong>
                  <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
                    {stakeholder.activeTasks} active tasks
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-600">{stakeholder.roles.join(", ") || "authorized stakeholder"}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                  <span>Watched Cargo</span>
                  <span className="text-slate-900">{stakeholder.touchedCargoCount}</span>
                  <span>Triggered Alerts</span>
                  <span className="text-slate-900">{stakeholder.activeAlerts}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Shared Operating Principles</CardTitle>
            <CardDescription>What changes when the platform is treated as a shared cargo intelligence layer.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            `${payload?.summary?.stakeholderCount || 0} authorized stakeholder nodes in the live operating graph`,
            `${payload?.summary?.activeStakeholders || 0} parties currently acting on alerts or tasks`,
            `${payload?.summary?.partiesWithCustody || 0} parties carrying custody context`,
            "Same alerts, intervention status, and audit evidence across authorized parties",
            "Same closure and verification record once work is completed",
          ].map((item) => (
            <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              {item}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
