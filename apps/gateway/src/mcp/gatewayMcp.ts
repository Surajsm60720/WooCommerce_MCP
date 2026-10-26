import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { User } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  filterToolsForRole,
  isToolAllowed,
  permissionDeniedMessage,
} from "../services/permissions.js";
import { recordToolCallMetric } from "../services/metrics.js";
import { callUpstreamTool } from "../services/upstreamClient.js";
import {
  namespaceTool,
  parseNamespacedTool,
  parseTools,
} from "../services/servers.js";

type Session = {
  transport: StreamableHTTPServerTransport;
  user: User;
  apiKeyId?: string;
};

const sessions = new Map<string, Session>();

/** Drop in-memory MCP sessions that were opened with a revoked/deleted API key. */
export function dropSessionsForApiKey(apiKeyId: string): number {
  let n = 0;
  for (const [id, session] of sessions) {
    if (session.apiKeyId === apiKeyId) {
      try {
        session.transport.close?.();
      } catch {
        /* ignore */
      }
      sessions.delete(id);
      n += 1;
    }
  }
  return n;
}

function createGatewayServer(user: User): Server {
  const server = new Server(
    { name: "team-mcp-gateway", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const upstreams = await prisma.mcpServer.findMany({
      where: { enabled: true },
    });
    const tools = [];
    for (const upstream of upstreams) {
      // Use cached tool list so a dead upstream does not break aggregation
      for (const tool of parseTools(upstream)) {
        tools.push({
          name: namespaceTool(upstream.slug, tool.name),
          description: `[${upstream.name}] ${tool.description ?? tool.name}`,
          inputSchema: tool.inputSchema ?? {
            type: "object",
            properties: {},
          },
        });
      }
    }
    return { tools: filterToolsForRole(user.role, tools) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const namespaced = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const parsed = parseNamespacedTool(namespaced);
    if (!parsed) {
      throw new Error(
        `Tool names must be namespaced as {serverSlug}__{toolName}. Got: ${namespaced}`,
      );
    }

    if (!isToolAllowed(user.role, namespaced)) {
      const errorMessage = permissionDeniedMessage(namespaced, user.role);
      const upstream = await prisma.mcpServer.findUnique({
        where: { slug: parsed.slug },
      });
      recordToolCallMetric({
        serverSlug: parsed.slug,
        toolName: namespaced,
        success: false,
        durationMs: 0,
      });
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          serverId: upstream?.id ?? null,
          toolName: namespaced,
          success: false,
          errorMessage,
          durationMs: 0,
        },
      });
      throw new Error(errorMessage);
    }

    const upstream = await prisma.mcpServer.findUnique({
      where: { slug: parsed.slug },
    });
    if (!upstream || !upstream.enabled) {
      throw new Error(`Upstream server '${parsed.slug}' is disabled or missing`);
    }

    const started = Date.now();
    let success = false;
    let errorMessage: string | null = null;
    try {
      const result = await callUpstreamTool(upstream, parsed.toolName, args);
      success = true;
      const text =
        typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Upstream '${upstream.slug}' tool '${parsed.toolName}' failed: ${errorMessage}`,
      );
    } finally {
      const durationMs = Date.now() - started;
      recordToolCallMetric({
        serverSlug: upstream.slug,
        toolName: namespaced,
        success,
        durationMs,
      });
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          serverId: upstream.id,
          toolName: namespaced,
          success,
          errorMessage,
          durationMs,
        },
      });
    }
  });

  return server;
}

export async function handleGatewayMcp(
  req: Request & { user?: User; apiKeyId?: string },
  res: Response,
): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const apiKeyId = req.apiKeyId;

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (req.method === "POST") {
    const existing = sessionId ? sessions.get(sessionId) : undefined;
    if (existing) {
      if (existing.user.id !== user.id) {
        res.status(403).json({ error: "Session belongs to another user" });
        return;
      }
      // Session was opened with a key that has since been revoked / replaced
      if (existing.apiKeyId && apiKeyId && existing.apiKeyId !== apiKeyId) {
        sessions.delete(sessionId!);
        res.status(401).json({ error: "API key no longer matches this session" });
        return;
      }
      await existing.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      let transport!: StreamableHTTPServerTransport;
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, user, apiKeyId });
        },
      });
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) sessions.delete(id);
      };
      const mcp = createGatewayServer(user);
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: no valid session" },
      id: null,
    });
    return;
  }

  const existing = sessionId ? sessions.get(sessionId) : undefined;
  if (!existing) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  if (existing.user.id !== user.id) {
    res.status(403).send("Session belongs to another user");
    return;
  }
  if (existing.apiKeyId && apiKeyId && existing.apiKeyId !== apiKeyId) {
    sessions.delete(sessionId!);
    res.status(401).send("API key no longer matches this session");
    return;
  }
  await existing.transport.handleRequest(req, res);
}
