import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import CargoCustodyPage from "./CargoCustodyPage";

export default function CargoGraphPage() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {[
          { label: "Location Graph", detail: "Airport, warehouse, apron, truck, and aircraft state." },
          { label: "Custody Graph", detail: "Who touched cargo, where, and why." },
          { label: "Sensor Graph", detail: "Temperature, shock, tilt, seal, and telemetry links." },
          { label: "Exposure Graph", detail: "Warm, cold, dwell, and unauthorized opening events." },
          { label: "Intervention Graph", detail: "Task assignment, verification, and operational closure." },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
              <p className="mt-2 text-sm text-slate-700">{item.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Linked Cargo Digital Twin</CardTitle>
            <CardDescription>Operational graph view across logistics objects, linked events, replay evidence, custody state, and integrity reasoning.</CardDescription>
          </div>
        </CardHeader>
      </Card>

      <CargoCustodyPage />
    </div>
  );
}
