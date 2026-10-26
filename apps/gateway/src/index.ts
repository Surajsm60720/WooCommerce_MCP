import express from "express";
import cors from "cors";
import { config } from "./lib/config.js";
import { prisma } from "./lib/prisma.js";
import { requireJwtOrApiKey, type AuthedRequest } from "./middleware/auth.js";
import { handleGatewayMcp } from "./mcp/gatewayMcp.js";
import { authRouter, meRouter } from "./routes/auth.js";
import { serversRouter } from "./routes/servers.js";
import { teamRouter, keysRouter } from "./routes/team.js";
import { auditRouter } from "./routes/audit.js";
import { chatRouter } from "./routes/chat.js";
import { permissionsRouter } from "./routes/permissions.js";
import { storesRouter } from "./routes/stores.js";
import { seed } from "./services/seed.js";
import { refreshAllServers } from "./services/servers.js";
import { renderPrometheusMetrics } from "./services/metrics.js";
import { checkRateLimit } from "./services/rateLimit.js";
import { reconcileStores } from "./provisioning/provisioner.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "gateway" });
});

app.get("/metrics", (_req, res) => {
  res.type("text/plain; version=0.0.4").send(renderPrometheusMetrics());
});

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Team MCP Gateway</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; color: #0f172a; line-height: 1.5; }
    code { background: #f1f5f9; padding: 0.1rem 0.35rem; border-radius: 4px; }
    a { color: #0f766e; }
  </style>
</head>
<body>
  <h1>Team MCP Gateway</h1>
  <p>This host is the API / MCP endpoint, not the dashboard UI.</p>
  <ul>
    <li>Dashboard: <a href="http://dashboard.local">http://dashboard.local</a></li>
    <li>Health: <a href="/healthz"><code>/healthz</code></a></li>
    <li>MCP (Streamable HTTP): <code>/mcp</code> — requires <code>Authorization: Bearer &lt;api-key&gt;</code></li>
  </ul>
  <p>Create an API key in the dashboard (Team page), then connect Cursor / Claude Code / MCP Inspector to <code>${config.publicGatewayUrl.replace(/\/$/, "")}/mcp</code>.</p>
</body>
</html>`);
});

app.use("/api/auth", authRouter);
app.use("/api/me", meRouter);
app.use("/api/servers", serversRouter);
app.use("/api/team", teamRouter);
app.use("/api/keys", keysRouter);
app.use("/api/audit", auditRouter);
app.use("/api/chat", chatRouter);
app.use("/api/permissions", permissionsRouter);
app.use("/api/stores", storesRouter);

app.all("/mcp", requireJwtOrApiKey, async (req: AuthedRequest, res) => {
  const key = req.user?.id ?? req.ip ?? "anon";
  const limit = checkRateLimit(`mcp:${key}`);
  res.setHeader("X-RateLimit-Remaining", String(limit.remaining));
  if (!limit.ok) {
    res.setHeader("Retry-After", String(limit.retryAfterSec));
    res.status(429).json({
      error: "Rate limit exceeded for MCP endpoint",
      retryAfterSec: limit.retryAfterSec,
    });
    return;
  }
  await handleGatewayMcp(req, res);
});

async function main() {
  await prisma.$connect();
  await seed();
  reconcileStores().catch((err) =>
    console.warn("store reconcile failed", err),
  );

  setInterval(() => {
    refreshAllServers().catch((err) =>
      console.warn("status refresh failed", err),
    );
  }, 30_000);

  setInterval(() => {
    reconcileStores().catch((err) =>
      console.warn("store reconcile failed", err),
    );
  }, 60_000);

  app.listen(config.port, "0.0.0.0", () => {
    console.log(`gateway listening on :${config.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
