import { useEffect, useState } from "react";
import axios from "axios";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { useAeroStore } from "../store/use-aero-store";
import { authHeader } from "../lib/aero-control";
import { requestGeminiInterventionAssist } from "../lib/gemini";
import { cn } from "../lib/utils";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";

export default function AiOpsPage() {
  const { ulds, alerts, tasks, assistantMessages, appendAssistantMessage } = useAeroStore();
  const [prompt, setPrompt] = useState("Which shipment has the highest theft risk?");
  const [busy, setBusy] = useState(false);
  const [context, setContext] = useState<any | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await axios.get(`${apiUrl}/api/ai-ops`, {
          headers: authHeader(),
          timeout: 8000,
        });
        if (active) {
          setContext(response.data);
        }
      } catch {
        if (active) {
          setContext(null);
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

  async function handleAsk(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim() || busy) return;

    appendAssistantMessage({ role: "user", text: prompt.trim() });
    setBusy(true);
    try {
      const response = await axios.post(
        `${apiUrl}/api/ai-ops/query`,
        { prompt: prompt.trim() },
        { headers: authHeader(), timeout: 10000 },
      );
      appendAssistantMessage({ role: "assistant", text: response.data.answer || "No AI Ops answer returned." });
      setPrompt("");
    } catch {
      try {
        const response = await requestGeminiInterventionAssist({
          prompt,
          tasks,
          alerts,
          ulds,
        });
        appendAssistantMessage({ role: "assistant", text: response });
        setPrompt("");
      } catch {
        appendAssistantMessage({
          role: "assistant",
          text: "AI Ops is unavailable right now. The safest next step is to inspect the highest-risk cargo, confirm custody state, and close any open intervention gaps.",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_1fr]">
      <Card className="border-slate-900 bg-[#0f172a] text-slate-100 shadow-xl">
        <CardHeader>
          <div>
            <p className="text-sm font-semibold text-slate-50">AI Operational Reasoning</p>
            <p className="mt-0.5 text-xs text-slate-400">Ask why risk is rising, which handlers or corridors are failing, and what intervention creates the best outcome.</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleAsk} className="space-y-3">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="min-h-[120px] w-full rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-100 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl border border-blue-400/30 bg-blue-500/15 py-2 text-sm font-medium text-blue-100 transition-colors hover:bg-blue-500/25 disabled:opacity-60"
            >
              {busy ? "Reasoning..." : "Ask AI Ops"}
            </button>
          </form>

          <div className="space-y-3">
            {assistantMessages.slice(-6).map((message) => (
              <div
                key={message.id}
                className={cn(
                  "rounded-2xl border p-4 text-sm",
                  message.role === "assistant" ? "border-blue-500/20 bg-blue-500/10 text-slate-100" : "border-slate-700 bg-slate-900/70 text-slate-200",
                )}
              >
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {message.role === "assistant" ? "AI Ops" : "Operator"}
                </p>
                <p className="whitespace-pre-wrap">{message.text}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Reasoning Targets</CardTitle>
              <CardDescription>Operational questions the platform should answer consistently.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {(context?.recommendedQuestions || [
              "Why is cargo risk increasing?",
              "What operational event caused the exposure?",
              "Show all cargo with broken custody chain.",
              "Which shipment has the highest theft risk?",
              "Replay movement timeline.",
            ]).map((item: string) => (
              <button
                key={item}
                onClick={() => setPrompt(item)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left text-sm text-slate-700 transition-colors hover:bg-white"
              >
                {item}
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Active Reasoning Context</CardTitle>
              <CardDescription>Live graph fragments and execution signals currently driving AI operational context.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Tracked Cargo", value: String(context?.context?.trackedCargo || 0) },
              { label: "Active Alerts", value: String(context?.context?.activeAlerts || 0) },
              { label: "Pending Interventions", value: String(context?.context?.pendingInterventions || 0) },
              {
                label: "Highest Risk Cargo",
                value: context?.context?.highestRiskCargo
                  ? `${context.context.highestRiskCargo.cargoId} @ ${context.context.highestRiskCargo.location}`
                  : "No active cargo risk context",
              },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{item.value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
