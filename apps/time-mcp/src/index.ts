import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 3102);

function createServer(): McpServer {
  const server = new McpServer({ name: "time-mcp", version: "1.0.0" });

  server.tool(
    "get_current_time",
    "Get the current date and time in a timezone (defaults to UTC)",
    {
      timezone: z
        .string()
        .optional()
        .describe("IANA timezone, e.g. UTC or America/New_York"),
    },
    async ({ timezone }) => {
      const tz = timezone || "UTC";
      const now = new Date();
      let formatted: string;
      try {
        formatted = new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(now);
      } catch {
        throw new Error(`Invalid timezone: ${tz}`);
      }
      const dateParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);
      const y = dateParts.find((p) => p.type === "year")?.value;
      const m = dateParts.find((p) => p.type === "month")?.value;
      const d = dateParts.find((p) => p.type === "day")?.value;
      const todayIsoDate = `${y}-${m}-${d}`;
      const afterIso = `${todayIsoDate}T00:00:00.000Z`;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                timezone: tz,
                iso_utc: now.toISOString(),
                local_formatted: formatted,
                today_date: todayIsoDate,
                after_iso_for_orders_today: afterIso,
                unix_ms: now.getTime(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "list_timezones",
    "List a curated set of common IANA timezones",
    {},
    async () => {
      const zones = [
        "UTC",
        "America/New_York",
        "America/Los_Angeles",
        "Europe/London",
        "Europe/Berlin",
        "Asia/Kolkata",
        "Asia/Tokyo",
        "Australia/Sydney",
      ];
      return {
        content: [{ type: "text", text: JSON.stringify(zones, null, 2) }],
      };
    },
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "1mb" }));
const transports = new Map<string, StreamableHTTPServerTransport>();

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "time-mcp" });
});

app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (transport) {
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
        },
      });
      transport.onclose = () => {
        const id = transport!.sessionId;
        if (id) transports.delete(id);
      };
      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: missing or invalid session" },
      id: null,
    });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : "Internal error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transport.handleRequest(req, res);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`time-mcp listening on :${PORT}`);
});
