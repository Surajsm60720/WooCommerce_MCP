# System design and tradeoffs

## Architecture

The platform runs entirely in Kubernetes and is packaged as one Helm chart (`charts/mcp-platform`).

| Component | Role |
|-----------|------|
| WordPress + WooCommerce + MariaDB | The store (persistent volumes) |
| `woocommerce-mcp` | Custom MCP server over Streamable HTTP; talks to the store via WooCommerce REST API |
| `time-mcp`, `notes-mcp` | Two additional in-cluster upstream MCP servers |
| `gateway` | REST admin API + aggregated MCP endpoint + Groq chat tool loop |
| Postgres (`gateway-db`) | Users, API keys (hashed), server registry, audit log |
| `dashboard` | React UI (nginx) proxying `/api` and `/mcp` to the gateway |

External clients (Cursor, Claude Code, MCP Inspector) and the dashboard chat agent only talk to the **gateway**. Upstream MCP URLs and credentials never leave the cluster server side.

## Orders date filtering

`woocommerce__list_orders` accepts:

- `today: true` — UTC calendar day (`after` = start of day, `before` = start of next day)
- `after` / `before` — ISO8601 closed range (WooCommerce REST query params)

Chat prefers `today=true`; dual-upstream demos may still use `time__get_current_time` plus explicit bounds.

## Why WooCommerce REST API

The WooCommerce MCP server uses the official REST API (`/wp-json/wc/v3/...`) with consumer key/secret Basic auth.

- Stable product/order surface without mounting WordPress files into the MCP pod
- Clear credential boundary (Secret mounted only on `woocommerce-mcp`)
- Works across upgrades of the WordPress image as long as WooCommerce remains installed

WP-CLI is used only in a one-shot bootstrap Job to install WooCommerce, enable COD, and insert the REST API key.

## Tool aggregation, routing, failures

- **Namespacing:** tools are exposed as `{serverSlug}__{toolName}` (example: `woocommerce__list_orders`). The gateway strips the prefix before calling the upstream.
- **Listing:** `tools/list` unions cached tool definitions from every **enabled** server. A slow or dead upstream does not block listing of others (probes are timed out and isolated).
- **Calling:** each upstream call has a timeout (`UPSTREAM_TIMEOUT_MS`, default 10s). Failures return a clear error; other servers keep working.
- **Disable vs unreachable:** disabling a server removes its tools from list/call paths. Killing a pod marks the server **Unreachable** in the dashboard; cached tools may still appear until disable, but calls fail with a timeout/connection error.
- **Credentials:** optional bearer/header credentials for upstreams are stored in Postgres and applied only by the gateway’s MCP client. They are never returned by the REST API.

## Auth model

- Dashboard session: JWT after email/password login
- External MCP: `Authorization: Bearer mcp_...` API keys (SHA-256 hashed at rest; revocable)
- Roles: `admin` (servers + team + mutating tools) and `member` (keys, chat, read tools)
- Tool allowlist enforced in gateway `tools/list` + `tools/call` and in the chat tool loop

## Chat agent

The chat endpoint uses Groq’s OpenAI-compatible API. The model receives **role-filtered** namespaced tool definitions from enabled servers and executes tool calls through the same upstream client path used by the MCP endpoint. Audit rows are attributed to the logged-in user.

## Multi-store provisioning

Admins create stores from the dashboard. The gateway (ServiceAccount + ClusterRole) applies a per-store namespace `store-{slug}` with MariaDB, WordPress, bootstrap Job, WooCommerce MCP (ClusterIP), Ingress (`store-{slug}.local`), ResourceQuota/LimitRange, and NetworkPolicies. After bootstrap succeeds, it registers an MCP server `woo-{slug}` so tools are clearly store-scoped (`woo-harbor-east__list_orders`). Delete removes the MCP registration and the namespace. Concurrent provisions are supported; each store is tracked independently with retry-safe apply.

## Observability

- Rolling-window summary: `GET /api/servers/metrics-summary` (dashboard Servers panel)
- Prometheus text: `GET /metrics` on the gateway (`mcp_gateway_*` series)
- Server cards show last probe error reason (timeout vs connection refused vs HTTP)

## Production differences (Helm values)

Local (`values-local.yaml`) vs prod-like (`values-prod.yaml`):

| Concern | Local (Kind) | Prod (k3s) |
|---------|--------------|------------|
| Domains | `*.local` via `/etc/hosts` → `127.0.0.1` | Real DNS to the VPS |
| Ingress class | `nginx` (ingress-nginx) | `traefik` (k3s default) or nginx |
| Images | `mcp-platform/*:local` + `imagePullPolicy: Never` | Registry images |
| Storage class | `standard` | `local-path` (k3s) or cloud CSI |
| Secrets | demo defaults / `--set` | private values file or external secret manager |
| TLS | optional | cert-manager recommended |

Same chart; configuration-only changes.

## Upgrade and rollback (Helm)

```bash
# Upgrade (local example)
helm upgrade mcp-platform ./charts/mcp-platform \
  --namespace mcp-platform \
  -f charts/mcp-platform/values.yaml \
  -f charts/mcp-platform/values-local.yaml \
  --set secrets.groqApiKey="$GROQ_API_KEY"

helm history mcp-platform -n mcp-platform

# Roll back one revision
helm rollback mcp-platform 1 -n mcp-platform
```

Production uses the same chart with `-f values-prod.yaml -f secrets.prod.yaml` (and registry image tags).
