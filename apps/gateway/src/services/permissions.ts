import type { Role } from "@prisma/client";

/**
 * Role-based tool allowlist for the aggregated gateway.
 * Member = read-oriented store ops (default + provisioned woo-*) + time + list notes.
 * Admin = all tools from enabled upstreams.
 */
const MEMBER_EXACT = new Set([
  "woocommerce__list_products",
  "woocommerce__list_orders",
  "woocommerce__get_order",
  "notes__list_notes",
]);

const MEMBER_PREFIX = ["time__"] as const;

/** Provisioned stores register as woo-{slug}__{tool} */
const MEMBER_WOO_STORE_READ =
  /^woo-[a-z0-9-]+__(list_products|list_orders|get_order)$/;

export type ToolPermissionPolicy = {
  role: Role;
  description: string;
  allowExact: string[];
  allowPrefixes: string[];
  note: string;
};

export function getPermissionPolicies(): ToolPermissionPolicy[] {
  return [
    {
      role: "admin",
      description: "Full access to every tool on every enabled upstream server.",
      allowExact: ["*"],
      allowPrefixes: ["*"],
      note: "Can create products, update order status, create notes, and manage all stores.",
    },
    {
      role: "member",
      description: "Read store data (default + provisioned woo-* stores) and use time/notes list tools.",
      allowExact: [...MEMBER_EXACT, "woo-*__list_products", "woo-*__list_orders", "woo-*__get_order"],
      allowPrefixes: [...MEMBER_PREFIX],
      note: "Cannot create products, update order status, or create notes.",
    },
  ];
}

export function isToolAllowed(role: Role, namespacedName: string): boolean {
  if (role === "admin") return true;
  if (MEMBER_EXACT.has(namespacedName)) return true;
  if (MEMBER_WOO_STORE_READ.test(namespacedName)) return true;
  return MEMBER_PREFIX.some((p) => namespacedName.startsWith(p));
}

export function filterToolsForRole<T extends { name: string }>(
  role: Role,
  tools: T[],
): T[] {
  return tools.filter((t) => isToolAllowed(role, t.name));
}

export function permissionDeniedMessage(namespacedName: string, role: Role): string {
  return `Permission denied: role '${role}' cannot call tool '${namespacedName}'. Members may only use read tools (list/get products & orders, time_*, list_notes).`;
}

/** True when the bare upstream tool name is considered mutating (for UI badges). */
export function isMutatingToolName(toolName: string): boolean {
  return (
    toolName.startsWith("create_") ||
    toolName.startsWith("update_") ||
    toolName.startsWith("delete_") ||
    toolName.includes("update_order")
  );
}
