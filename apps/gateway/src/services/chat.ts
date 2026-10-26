import OpenAI from "openai";
import type { User } from "@prisma/client";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { isToolAllowed, permissionDeniedMessage } from "./permissions.js";
import { callUpstreamTool } from "./upstreamClient.js";
import {
  namespaceTool,
  parseNamespacedTool,
  parseTools,
} from "./servers.js";
import { recordToolCallMetric } from "./metrics.js";

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export type ToolCallRecord = {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  success: boolean;
};

/** Groq free tier has tight TPM limits — keep schemas tiny. */
function compactJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {
    type: typeof src.type === "string" ? src.type : "object",
  };
  if (src.properties && typeof src.properties === "object") {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(
      src.properties as Record<string, unknown>,
    )) {
      if (!val || typeof val !== "object") {
        props[key] = { type: "string" };
        continue;
      }
      const v = val as Record<string, unknown>;
      const prop: Record<string, unknown> = {};
      if (typeof v.type === "string") prop.type = v.type;
      if (typeof v.description === "string") {
        prop.description = v.description.slice(0, 160);
      }
      if (Array.isArray(v.enum)) prop.enum = v.enum.slice(0, 20);
      props[key] = Object.keys(prop).length ? prop : { type: "string" };
    }
    out.properties = props;
  } else {
    out.properties = {};
  }
  if (Array.isArray(src.required)) out.required = src.required;
  return out;
}

function truncateForModel(value: unknown, maxChars = 2500): string {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…(truncated)`;
}

async function loadToolDefinitions(role: User["role"]) {
  const servers = await prisma.mcpServer.findMany({
    where: { enabled: true },
  });
  const tools: OpenAI.Chat.ChatCompletionTool[] = [];
  for (const server of servers) {
    for (const t of parseTools(server)) {
      const name = namespaceTool(server.slug, t.name);
      if (!isToolAllowed(role, name)) continue;
      const desc = `[${server.name}] ${t.description ?? t.name}`.slice(0, 200);
      tools.push({
        type: "function",
        function: {
          name,
          description: desc,
          parameters: compactJsonSchema(t.inputSchema),
        },
      });
    }
  }
  return { tools, servers };
}

export async function runChat(
  user: User,
  message: string,
  history: ChatMessage[] = [],
): Promise<{ reply: string; toolCalls: ToolCallRecord[] }> {
  if (!config.groqApiKey) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const client = new OpenAI({
    apiKey: config.groqApiKey,
    baseURL: config.groqBaseUrl,
  });

  const { tools, servers } = await loadToolDefinitions(user.role);
  const toolCalls: ToolCallRecord[] = [];
  const toolNames = tools
    .map((t) => (t.type === "function" ? t.function.name : ""))
    .filter(Boolean);

  const recentHistory = history.slice(-8);

  const roleHint =
    user.role === "member"
      ? " You are a member: you may only use read tools. Never invent create/update tools."
      : " You are an admin: mutating tools are available when needed.";

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You are a store ops assistant. Call tools only by exact name from this list (copy spelling carefully): " +
        toolNames.join(", ") +
        ". For today's orders prefer woocommerce__list_orders with today=true (UTC day). You may also use time__get_current_time then after/before. Keep answers concise." +
        roleHint,
    },
    ...recentHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.slice(0, 2000),
    })),
    { role: "user", content: message.slice(0, 2000) },
  ];

  for (let step = 0; step < 6; step++) {
    let completion;
    try {
      completion = await client.chat.completions.create({
        model: config.groqModel,
        messages,
        tools: tools.length ? tools : undefined,
        tool_choice: tools.length ? "auto" : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Model sometimes invents a near-miss tool name; ask it to retry with exact names.
      if (msg.includes("tool call validation failed") && step < 5) {
        messages.push({
          role: "user",
          content:
            "Your previous tool call used an invalid tool name. Retry using ONLY an exact name from: " +
            toolNames.join(", "),
        });
        continue;
      }
      throw err;
    }

    const choice = completion.choices[0];
    const msg = choice.message;
    messages.push(msg);

    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      return { reply: msg.content ?? "", toolCalls };
    }

    for (const call of calls) {
      if (call.type !== "function") continue;
      let name = call.function.name;
      // Fix common near-miss typos against the known tool list
      if (!toolNames.includes(name)) {
        const match = toolNames.find(
          (n) =>
            n.replace(/[^a-z0-9]/g, "") === name.replace(/[^a-z0-9]/g, ""),
        );
        if (match) name = match;
      }
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<
          string,
          unknown
        >;
      } catch {
        args = {};
      }

      const parsed = parseNamespacedTool(name);
      const started = Date.now();
      let success = false;
      let result: unknown = null;
      let errorMessage: string | null = null;
      let serverId: string | null = null;

      try {
        if (!parsed) throw new Error(`Invalid tool name: ${name}`);
        if (!isToolAllowed(user.role, name)) {
          throw new Error(permissionDeniedMessage(name, user.role));
        }
        const server = servers.find((s) => s.slug === parsed.slug);
        if (!server) throw new Error(`Unknown or disabled server: ${parsed.slug}`);
        serverId = server.id;
        result = await callUpstreamTool(server, parsed.toolName, args);
        success = true;
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
        result = { error: errorMessage };
      }

      const durationMs = Date.now() - started;
      const slug = parsed?.slug ?? "unknown";
      recordToolCallMetric({
        serverSlug: slug,
        toolName: name,
        success,
        durationMs,
      });
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          serverId,
          toolName: name,
          success,
          errorMessage,
          durationMs,
        },
      });

      toolCalls.push({ name, arguments: args, result, success });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: truncateForModel(result),
      });
    }
  }

  return {
    reply: "I hit the tool-call step limit. Please try a simpler question.",
    toolCalls,
  };
}
