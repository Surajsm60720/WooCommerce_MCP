import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServer } from "@prisma/client";
import { config } from "../lib/config.js";

export type UpstreamTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

function authHeaders(server: McpServer): Record<string, string> {
  if (server.credentialType === "bearer" && server.credentialValue) {
    return { Authorization: `Bearer ${server.credentialValue}` };
  }
  if (
    server.credentialType === "header" &&
    server.credentialHeader &&
    server.credentialValue
  ) {
    return { [server.credentialHeader]: server.credentialValue };
  }
  return {};
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function listUpstreamTools(server: McpServer): Promise<UpstreamTool[]> {
  const client = new Client({ name: "team-mcp-gateway", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: authHeaders(server) },
  });
  try {
    await withTimeout(client.connect(transport), config.upstreamTimeoutMs, "connect");
    const result = await withTimeout(
      client.listTools(),
      config.upstreamTimeoutMs,
      "listTools",
    );
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }));
  } finally {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}

export async function callUpstreamTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const client = new Client({ name: "team-mcp-gateway", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: authHeaders(server) },
  });
  try {
    await withTimeout(client.connect(transport), config.upstreamTimeoutMs, "connect");
    const result = await withTimeout(
      client.callTool({ name: toolName, arguments: args }),
      config.upstreamTimeoutMs,
      `callTool ${toolName}`,
    );
    return result;
  } finally {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}

export async function probeUpstream(server: McpServer): Promise<{
  ok: boolean;
  tools: UpstreamTool[];
  error?: string;
}> {
  try {
    const tools = await listUpstreamTools(server);
    return { ok: true, tools };
  } catch (err) {
    return {
      ok: false,
      tools: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
