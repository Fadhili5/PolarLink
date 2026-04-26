import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";

export function isProductionLegacyGateEnabled() {
  return import.meta.env.PROD && import.meta.env.VITE_ALLOW_SIMULATOR_DATA !== "true";
}

export function ProductionGate({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const gated = isProductionLegacyGateEnabled();

  if (!gated) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This surface is disabled in production until it is wired exclusively to live validated integrations.
        </div>
      </CardContent>
    </Card>
  );
}
