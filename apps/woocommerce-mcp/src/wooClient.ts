export type WooConfig = {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
};

function authHeader(cfg: WooConfig): string {
  const token = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString("base64");
  return `Basic ${token}`;
}

async function wooFetch<T>(
  cfg: WooConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(cfg),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body && "message" in body
        ? String((body as { message: string }).message)
        : `WooCommerce API ${res.status}: ${text.slice(0, 300)}`;
    throw new Error(msg);
  }
  return body as T;
}

export type Product = {
  id: number;
  name: string;
  price: string;
  status: string;
  permalink?: string;
};

export type Order = {
  id: number;
  status: string;
  total: string;
  currency: string;
  date_created: string;
  billing?: { first_name?: string; last_name?: string; email?: string };
  line_items?: Array<{ name: string; quantity: number; total: string }>;
};

export async function listProducts(cfg: WooConfig, perPage = 20): Promise<Product[]> {
  return wooFetch(cfg, `/wp-json/wc/v3/products?per_page=${perPage}`);
}

export async function createProduct(
  cfg: WooConfig,
  input: { name: string; regular_price: string; description?: string },
): Promise<Product> {
  return wooFetch(cfg, "/wp-json/wc/v3/products", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      type: "simple",
      regular_price: input.regular_price,
      description: input.description ?? "",
      status: "publish",
    }),
  });
}

export async function listOrders(
  cfg: WooConfig,
  opts: {
    after?: string;
    before?: string;
    perPage?: number;
    status?: string;
  } = {},
): Promise<Order[]> {
  const params = new URLSearchParams();
  params.set("per_page", String(opts.perPage ?? 20));
  if (opts.after) params.set("after", opts.after);
  if (opts.before) params.set("before", opts.before);
  if (opts.status) params.set("status", opts.status);
  return wooFetch(cfg, `/wp-json/wc/v3/orders?${params.toString()}`);
}

export async function getOrder(cfg: WooConfig, id: number): Promise<Order> {
  return wooFetch(cfg, `/wp-json/wc/v3/orders/${id}`);
}

export async function updateOrderStatus(
  cfg: WooConfig,
  id: number,
  status: string,
): Promise<Order> {
  return wooFetch(cfg, `/wp-json/wc/v3/orders/${id}`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}
