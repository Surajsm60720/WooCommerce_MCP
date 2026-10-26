type Sample = {
  serverSlug: string;
  toolName: string;
  success: boolean;
  durationMs: number;
  at: number;
};

const WINDOW_MS = 15 * 60 * 1000;
const samples: Sample[] = [];

export function recordToolCallMetric(input: {
  serverSlug: string;
  toolName: string;
  success: boolean;
  durationMs: number;
}): void {
  const now = Date.now();
  samples.push({ ...input, at: now });
  // Bound memory
  while (samples.length > 5000) samples.shift();
  const cutoff = now - WINDOW_MS;
  while (samples.length && samples[0].at < cutoff) samples.shift();
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

export function getMetricsSummary() {
  const now = Date.now();
  const recent = samples.filter((s) => s.at >= now - WINDOW_MS);
  const byServer = new Map<
    string,
    { calls: number; errors: number; durations: number[] }
  >();

  for (const s of recent) {
    const row = byServer.get(s.serverSlug) ?? {
      calls: 0,
      errors: 0,
      durations: [],
    };
    row.calls += 1;
    if (!s.success) row.errors += 1;
    row.durations.push(s.durationMs);
    byServer.set(s.serverSlug, row);
  }

  const servers = [...byServer.entries()].map(([serverSlug, row]) => {
    const durations = [...row.durations].sort((a, b) => a - b);
    return {
      serverSlug,
      calls: row.calls,
      errors: row.errors,
      errorRate: row.calls ? row.errors / row.calls : 0,
      p95Ms: percentile(durations, 95),
      avgMs: row.calls
        ? Math.round(durations.reduce((a, b) => a + b, 0) / row.calls)
        : 0,
    };
  });

  return {
    windowMinutes: 15,
    totalCalls: recent.length,
    totalErrors: recent.filter((s) => !s.success).length,
    servers,
  };
}

/** Prometheus text exposition for /metrics */
export function renderPrometheusMetrics(): string {
  const summary = getMetricsSummary();
  const lines: string[] = [
    "# HELP mcp_gateway_tool_calls_total Tool calls in the rolling window",
    "# TYPE mcp_gateway_tool_calls_total gauge",
    `mcp_gateway_tool_calls_total ${summary.totalCalls}`,
    "# HELP mcp_gateway_tool_errors_total Tool call errors in the rolling window",
    "# TYPE mcp_gateway_tool_errors_total gauge",
    `mcp_gateway_tool_errors_total ${summary.totalErrors}`,
  ];
  for (const s of summary.servers) {
    const labels = `server="${s.serverSlug}"`;
    lines.push(`mcp_gateway_server_calls{${labels}} ${s.calls}`);
    lines.push(`mcp_gateway_server_errors{${labels}} ${s.errors}`);
    lines.push(`mcp_gateway_server_p95_ms{${labels}} ${s.p95Ms}`);
  }
  return `${lines.join("\n")}\n`;
}
