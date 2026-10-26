# Threat model (short)

## Shared upstream credentials

Admins register upstream MCP servers with optional static credentials (bearer/header). Those secrets stay on the gateway. Members never see them in the UI or API responses (`toPublicServer` omits values).

**What a member can do:** call only tools allowed for the `member` role (read products/orders, time tools, list notes). Mutating tools (`create_product`, `update_order_status`, `create_note`) are hidden from `tools/list` and rejected on direct call; denials are audited.

## Client tokens are not passed upstream

User API keys and dashboard JWTs authenticate to the gateway only. Upstream calls use the server-side credential configured for that MCP server. This prevents:

- leaking team member tokens to third-party MCP servers
- upstreams impersonating users against the gateway

## Untrusted upstreams / tool description injection

Tool names and descriptions from upstreams are shown to the LLM and to clients. A malicious upstream could craft descriptions that manipulate the model (“ignore previous instructions…”).

Trust boundary: only admins can register upstream URLs. Prefer ClusterIP services you control. Treat external URLs as hostile.

**SSRF guard:** admin add/edit URL rejects loopback, link-local / cloud metadata (`169.254.169.254`), and raw private IPs. Prefer in-cluster DNS (`*.svc.cluster.local` or short service names). Optional `UPSTREAM_URL_ALLOWLIST` further restricts hostnames.

**If a compromised MCP is registered anyway:** it cannot receive team API keys; it can only return tool results/descriptions to the gateway. NetworkPolicies keep upstreams off the public internet. Disable or delete the server to cut it off; audit shows prior calls.

## Member vs admin

- Members cannot manage servers or invite users.
- Members can create and revoke **their own** API keys; admins can revoke any key.
- Audit: members see their own tool calls; admins see all.
- Tool permissions differ by role (see dashboard Servers → Tool permissions).

## Member vs member

Members share the same upstream authority for **allowed** tools (read products/orders, time, list notes). Implications:

- **Shared store side-effects:** any member who can call a tool affects the same WooCommerce data. Today members cannot mutate; if permissions were widened, one member’s writes would be visible to others.
- **API keys:** a member cannot list or revoke another member’s keys — only their own. Admins can revoke any key.
- **Audit privacy:** members see only their own audit rows; they cannot inspect a peer’s tool history.
- **Chat / MCP:** both members hit the same gateway and enabled upstreams; isolation is by API key identity + role allowlist, not by per-user data tenancy.
- **Compromise of one key:** revoke that key; other members’ keys remain valid. Rotate upstream Woo credentials only if the upstream secret itself leaked (admin-only).

## Network exposure

- Upstream MCP servers have no Ingress; only the gateway can reach them (NetworkPolicies).
- Storefront and dashboard/gateway are exposed via Ingress.
- MariaDB and gateway Postgres accept connections only from their application pods.
- Gateway and MCP server pods run as non-root (`runAsNonRoot`).
- MCP endpoint has a per-user rate limit (`MCP_RATE_LIMIT_PER_MINUTE`, default 120).
