# WooCommerce hosting with Team MCP Gateway

Kubernetes platform: a WooCommerce store, a custom WooCommerce MCP server, two extra upstream MCP servers, and a team gateway with React dashboard + Groq chat agent.

Everything is deployed with **Helm** (same chart for Kind locally and k3s on a VPS).

## Personas (seeded)

| Persona | Email | Default password | Role |
|---------|-------|------------------|------|
| **Ava Admin** | `ava@demo.local` | `AvaAdmin123!` | admin |
| **Ben Member** | `ben@demo.local` | `BenMember123!` | member |
| **Shopper Sam** | — | storefront guest | places COD orders |

## Repository layout

- `apps/gateway` — REST API, MCP aggregation endpoint, chat tool loop
- `apps/dashboard` — React dashboard
- `apps/woocommerce-mcp` — custom Streamable HTTP MCP server (WooCommerce REST)
- `apps/time-mcp`, `apps/notes-mcp` — additional upstream MCP servers
- `charts/mcp-platform` — Helm chart + `values-local.yaml` / `values-prod.yaml`
- `docs/` — system design and threat model

## Prerequisites

- Docker, Kind, kubectl, Helm 3
- Node 22+ (optional, for local app dev)
- Groq API key for chat (`GROQ_API_KEY`)

## Local setup (Kind)

Secrets are **not** in `values.yaml`. `kind-up.sh` loads `charts/mcp-platform/secrets.example.yaml` (or `secrets.local.yaml` if you create one).

```bash
export GROQ_API_KEY=gsk_...
chmod +x scripts/*.sh
./scripts/kind-up.sh
```

After code changes, rebuild images and upgrade:

```bash
./scripts/build-images.sh
# reload into Kind, then:
helm upgrade mcp-platform ./charts/mcp-platform -n mcp-platform \
  -f charts/mcp-platform/values.yaml \
  -f charts/mcp-platform/values-local.yaml \
  -f charts/mcp-platform/secrets.example.yaml \
  --set secrets.groqApiKey="$GROQ_API_KEY"
kubectl -n mcp-platform rollout restart deploy/gateway deploy/dashboard deploy/woocommerce-mcp
```

Add to `/etc/hosts`:

```text
127.0.0.1 store.local dashboard.local gateway.local
```

Kind’s ingress controller is mapped to host ports **80/443**, so browsers use `*.local` on localhost.

| URL | Service |
|-----|---------|
| http://store.local | Storefront + `/wp-admin` |
| http://dashboard.local | Team dashboard |
| http://gateway.local/mcp | Aggregated MCP endpoint |
| http://gateway.local/healthz | Gateway health |

WordPress admin defaults: `admin` / `AdminChangeMe123!` (override via Helm `secrets.*`).

Tear down: `./scripts/kind-down.sh`.

### How WooCommerce MCP talks to the store

It uses the **WooCommerce REST API** with consumer key/secret from a Kubernetes Secret. See [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md).

Upstream MCP servers are **ClusterIP only** (no Ingress). NetworkPolicies restrict who can call them.

## Place an order (Sam)

1. Open http://store.local
2. Add a product → Checkout → Cash on delivery
3. Confirm under WooCommerce → Orders in wp-admin

## Use the chat agent (Ava)

1. Open http://dashboard.local and sign in as Ava
2. Chat examples (or use on-screen starters):
   - “Create a product named Harbor Flask SKU HF-240 priced 29.99”
   - “What orders came in today in UTC? Use current time then list orders.”
3. Open **Servers** for permission matrix + metrics; **Audit** for Ava-attributed calls

## Connect an external MCP client (Ben)

1. Sign in as Ben → **Team** → create an API key (copy once)
2. MCP URL: `http://gateway.local/mcp`
3. Header: `Authorization: Bearer <ben-api-key>`

### Cursor example (`mcp.json`)

```json
{
  "mcpServers": {
    "team-gateway": {
      "url": "http://gateway.local/mcp",
      "headers": {
        "Authorization": "Bearer mcp_YOUR_KEY_HERE"
      }
    }
  }
}
```

Tool names are namespaced: `{serverSlug}__{toolName}` (e.g. `woocommerce__list_orders`, `time__get_current_time`).

## VPS / k3s (production-like)

1. Install k3s; ensure Traefik (default) or install ingress-nginx.
2. Build/push images to a registry; set `images.*` in a private values file.
3. Point DNS for store/dashboard/gateway hosts at the VPS.
4. Install:

```bash
helm upgrade --install mcp-platform ./charts/mcp-platform \
  --namespace mcp-platform --create-namespace \
  -f charts/mcp-platform/values.yaml \
  -f charts/mcp-platform/values-prod.yaml \
  -f secrets.prod.yaml
```

`secrets.prod.yaml` should set strong `secrets.*` values including `groqApiKey` (do not commit).

What changes vs local: domains, ingress class, storage class, image registry, TLS — documented in [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md).

## Local app development (without full cluster)

```bash
npm install
# run Postgres locally, set DATABASE_URL, then:
npm run prisma:push -w @platform/gateway
GROQ_API_KEY=... npm run dev -w @platform/gateway
npm run dev -w @platform/dashboard
```

## Docs

- [System design and tradeoffs](docs/SYSTEM_DESIGN.md)
- [Threat model](docs/THREAT_MODEL.md)

## Multi-store provisioning (bonus)

Admins open **Stores** in the dashboard and provision additional WooCommerce stores. Each store gets its own namespace (`store-{slug}`), MariaDB, WordPress PVC, bootstrap Job, ClusterIP WooCommerce MCP, Ingress host `store-{slug}.local`, ResourceQuota/LimitRange, and NetworkPolicies. The gateway registers MCP tools as `woo-{slug}__*` automatically.

```text
# After a store becomes Ready, add its host (example):
127.0.0.1 store-harbor-east.local
```

Demo: provision two stores → chat *Compare today's orders across every WooCommerce store* → delete one → its `woo-*` tools and namespace are gone.

## Stand-out items in this build

- **Tool permissions** — members get read tools only; mutating tools hidden + rejected + audited
- **Observability** — Servers panel metrics + gateway `/metrics`; last probe error reasons
- **SSRF guard** — admin URL add/edit blocks metadata/loopback/private IPs
- **Multi-store provisioning** — dashboard create/delete, auto MCP registration, isolation

Not in this delivery: OAuth, hosted MCP-by-image, multi-replica sticky sessions.
