/**
 * SSRF guard for admin-registered upstream MCP URLs.
 * Blocks cloud metadata, loopback, and link-local targets.
 * Allows http(s) to hostnames (typical in-cluster DNS like *.svc.cluster.local).
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function ipv4Parts(host: string): number[] | null {
  if (!isIpv4(host)) return null;
  const parts = host.split(".").map((p) => Number(p));
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

function isBlockedIpv4(host: string): boolean {
  const parts = ipv4Parts(host);
  if (!parts) return false;
  const [a, b] = parts;
  // loopback 127.0.0.0/8
  if (a === 127) return true;
  // RFC1918 private — block for SSRF (admins should use cluster DNS, not raw pod IPs)
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // link-local / cloud metadata
  if (a === 169 && b === 254) return true;
  // unspecified / broadcast-ish
  if (a === 0) return true;
  return false;
}

function isBlockedIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1") return true;
  if (h === "::") return true;
  // IPv4-mapped IPv6
  if (h.startsWith("::ffff:")) {
    const v4 = h.slice("::ffff:".length);
    return isBlockedIpv4(v4) || BLOCKED_HOSTS.has(v4);
  }
  // unique local / link-local
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) {
    return true;
  }
  return false;
}

export function assertSafeUpstreamUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid upstream URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Upstream URL must use http or https");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new Error("Upstream URL missing host");

  if (BLOCKED_HOSTS.has(host)) {
    throw new Error(
      `SSRF blocked: host '${host}' is not allowed for upstream MCP servers`,
    );
  }

  if (isBlockedIpv4(host) || isBlockedIpv6(host)) {
    throw new Error(
      `SSRF blocked: address '${host}' is not allowed (loopback, private IP, or link-local/metadata). Use an in-cluster service DNS name.`,
    );
  }

  const allowlist = (process.env.UPSTREAM_URL_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist.length > 0) {
    const ok = allowlist.some(
      (entry) => host === entry || host.endsWith(`.${entry}`),
    );
    if (!ok) {
      throw new Error(
        `SSRF blocked: host '${host}' is not in UPSTREAM_URL_ALLOWLIST`,
      );
    }
  }
}
