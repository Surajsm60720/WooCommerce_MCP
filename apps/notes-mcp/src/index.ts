import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 3103);

type Note = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

const notes: Note[] = [];

function createServer(): McpServer {
  const server = new McpServer({ name: "notes-mcp", version: "1.0.0" });

  server.tool(
    "create_note",
    "Create a short team note (in-memory; for demos)",
    {
      title: z.string().min(1),
      body: z.string().min(1),
    },
    async ({ title, body }) => {
      const note: Note = {
        id: randomUUID(),
        title,
        body,
        createdAt: new Date().toISOString(),
      };
      notes.unshift(note);
      return {
        content: [{ type: "text", text: JSON.stringify(note, null, 2) }],
      };
    },
  );

  server.tool(
    "list_notes",
    "List recently created notes",
    { limit: z.number().int().min(1).max(100).optional() },
    async ({ limit }) => {
      const items = notes.slice(0, limit ?? 20);
      return {
        content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
      };
    },
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "1mb" }));
const transports = new Map<string, StreamableHTTPServerTransport>();

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "notes-mcp", noteCount: notes.length });
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
  console.log(`notes-mcp listening on :${PORT}`);
});
