function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqBaseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
  publicGatewayUrl: process.env.PUBLIC_GATEWAY_URL ?? "http://gateway.local",
  upstreamTimeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS ?? 10_000),
  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL ?? "ava@demo.local",
    // Passwords must come from env / Kubernetes Secret — no committed defaults.
    adminPassword: required("SEED_ADMIN_PASSWORD"),
    adminName: process.env.SEED_ADMIN_NAME ?? "Ava Admin",
    memberEmail: process.env.SEED_MEMBER_EMAIL ?? "ben@demo.local",
    memberPassword: required("SEED_MEMBER_PASSWORD"),
    memberName: process.env.SEED_MEMBER_NAME ?? "Ben Member",
    wooMcpUrl: process.env.SEED_WOO_MCP_URL ?? "http://woocommerce-mcp:3101/mcp",
    timeMcpUrl: process.env.SEED_TIME_MCP_URL ?? "http://time-mcp:3102/mcp",
    notesMcpUrl: process.env.SEED_NOTES_MCP_URL ?? "http://notes-mcp:3103/mcp",
  },
};
