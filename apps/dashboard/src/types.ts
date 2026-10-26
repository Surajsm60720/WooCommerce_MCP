export type UserRole = 'admin' | 'member';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface McpToolSummary {
  name: string;
  description: string;
}

export interface McpServer {
  id: string;
  name: string;
  slug: string;
  url: string;
  enabled: boolean;
  status: string;
  lastError: string | null;
  lastCheckedAt: string | null;
  tools: McpToolSummary[];
  credentialType: string;
  hasCredential?: boolean;
}

export interface PermissionPolicy {
  role: UserRole;
  description: string;
  allowExact: string[];
  allowPrefixes: string[];
  note: string;
}

export interface PermissionResponse {
  policies: PermissionPolicy[];
  enforcement: string;
}

export interface MetricsServerRow {
  serverSlug: string;
  calls: number;
  errors: number;
  errorRate: number;
  p95Ms: number;
  avgMs: number;
}

export interface MetricsSummary {
  windowMinutes: number;
  totalCalls: number;
  totalErrors: number;
  servers: MetricsServerRow[];
}

export interface TeamMember {
  id?: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  revokedAt?: string | null;
  userEmail?: string;
  userName?: string;
}

export interface ApiKeyCreated extends ApiKey {
  key: string;
}

export interface GatewayInfo {
  mcpUrl: string;
  instructions: string;
}

export interface AuditEntry {
  id: string;
  userEmail: string;
  serverName: string;
  toolName: string;
  success: boolean;
  errorMessage: string | null;
  durationMs: number;
  createdAt: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatToolCall {
  name: string;
  arguments: unknown;
  result: unknown;
  success: boolean;
}

export interface ChatResponse {
  reply: string;
  toolCalls: ChatToolCall[];
}

export interface Store {
  id: string;
  name: string;
  slug: string;
  namespace: string;
  host: string;
  url: string;
  wpAdminUrl: string;
  hostsLine: string;
  status: string;
  statusReason: string | null;
  mcpServerId: string | null;
  mcpSlug: string;
  createdAt: string;
  updatedAt: string;
  createdByEmail: string | null;
}

export interface StoreAccess {
  url: string;
  wpAdminUrl: string;
  hostsLine: string;
  adminUser: string;
  adminPassword: string;
  adminEmail: string;
}

export interface StoresResponse {
  enabled: boolean;
  maxStoresPerUser: number;
  stores: Store[];
}
