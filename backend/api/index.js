export default async function handler(_req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (_req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  res.status(503).json({
    error: "Serverless mock API disabled",
    detail:
      "AeroSentinel production mode requires live integrations and validated event sources. Deploy the Express backend instead of the legacy mock handler.",
  });
}
