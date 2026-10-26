import type { McpServer } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { probeUpstream, type UpstreamTool } from "./upstreamClient.js";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function parseTools(server: McpServer): UpstreamTool[] {
  try {
    return JSON.parse(server.toolsJson) as UpstreamTool[];
  } catch {
    return [];
  }
}

export function toPublicServer(server: McpServer) {
  return {
    id: server.id,
    name: server.name,
    slug: server.slug,
    url: server.url,
    enabled: server.enabled,
    status: server.enabled ? server.status : "disabled",
    lastError: server.lastError,
    lastCheckedAt: server.lastCheckedAt,
    credentialType: server.credentialType,
    hasCredential: Boolean(server.credentialValue),
    tools: parseTools(server),
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  };
}

export async function refreshServerStatus(serverId: string) {
  const server = await prisma.mcpServer.findUnique({ where: { id: serverId } });
  if (!server) return null;
  if (!server.enabled) {
    return prisma.mcpServer.update({
      where: { id: serverId },
      data: { status: "disabled", lastCheckedAt: new Date() },
    });
  }
  const result = await probeUpstream(server);
  return prisma.mcpServer.update({
    where: { id: serverId },
    data: {
      status: result.ok ? "connected" : "unreachable",
      lastError: result.ok ? null : (result.error ?? "unreachable"),
      toolsJson: result.ok ? JSON.stringify(result.tools) : server.toolsJson,
      lastCheckedAt: new Date(),
    },
  });
}

export async function refreshAllServers() {
  const servers = await prisma.mcpServer.findMany();
  await Promise.allSettled(servers.map((s) => refreshServerStatus(s.id)));
}

/** Namespaced tool name: {slug}__{toolName} */
export function namespaceTool(slug: string, toolName: string): string {
  return `${slug}__${toolName}`;
}

export function parseNamespacedTool(namespaced: string): {
  slug: string;
  toolName: string;
} | null {
  const idx = namespaced.indexOf("__");
  if (idx <= 0) return null;
  return {
    slug: namespaced.slice(0, idx),
    toolName: namespaced.slice(idx + 2),
  };
}
