import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  createProduct,
  getOrder,
  listOrders,
  listProducts,
  updateOrderStatus,
  type WooConfig,
} from "./wooClient.js";

const PORT = Number(process.env.PORT ?? 3101);

function requireConfig(): WooConfig {
  const baseUrl = process.env.WOOCOMMERCE_URL;
  const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!baseUrl || !consumerKey || !consumerSecret) {
    throw new Error(
      "WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY, and WOOCOMMERCE_CONSUMER_SECRET are required",
    );
  }
  return { baseUrl, consumerKey, consumerSecret };
}

function createServer(cfg: WooConfig): McpServer {
  const server = new McpServer({
    name: "woocommerce-mcp",
    version: "1.0.0",
  });

  server.tool(
    "list_products",
    "List products from the WooCommerce store",
    { per_page: z.number().int().min(1).max(100).optional() },
    async ({ per_page }) => {
      const products = await listProducts(cfg, per_page ?? 20);
      return {
        content: [{ type: "text", text: JSON.stringify(products, null, 2) }],
      };
    },
  );

  server.tool(
    "create_product",
    "Create a simple published product with a name and price",
    {
      name: z.string().min(1),
      price: z.string().min(1).describe("Regular price as a string, e.g. 19.99"),
      description: z.string().optional(),
    },
    async ({ name, price, description }) => {
      const product = await createProduct(cfg, {
        name,
        regular_price: price,
        description,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(product, null, 2) }],
      };
    },
  );

  server.tool(
    "list_orders",
    "List WooCommerce orders. Use today=true for UTC calendar day, or after/before ISO bounds.",
    {
      today: z
        .boolean()
        .optional()
        .describe(
          "If true, return orders created during the current UTC calendar day (sets after/before unless overridden)",
        ),
      after: z
        .string()
        .optional()
        .describe("ISO8601 datetime; only orders created after this time"),
      before: z
        .string()
        .optional()
        .describe("ISO8601 datetime; only orders created before this time"),
      per_page: z.number().int().min(1).max(100).optional(),
      status: z.string().optional(),
    },
    async ({ today, after, before, per_page, status }) => {
      let afterBound = after;
      let beforeBound = before;
      if (today) {
        const start = new Date();
        start.setUTCHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);
        afterBound = afterBound ?? start.toISOString();
        beforeBound = beforeBound ?? end.toISOString();
      }
      const orders = await listOrders(cfg, {
        after: afterBound,
        before: beforeBound,
        perPage: per_page,
        status,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                filter: {
                  today: Boolean(today),
                  after: afterBound ?? null,
                  before: beforeBound ?? null,
                },
                orders,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "get_order",
    "Get a single WooCommerce order by id",
    { id: z.number().int().positive() },
    async ({ id }) => {
      const order = await getOrder(cfg, id);
      return {
        content: [{ type: "text", text: JSON.stringify(order, null, 2) }],
      };
    },
  );

  server.tool(
    "update_order_status",
    "Update the status of a WooCommerce order",
    {
      id: z.number().int().positive(),
      status: z
        .string()
        .describe("e.g. pending, processing, completed, cancelled, on-hold"),
    },
    async ({ id, status }) => {
      const order = await updateOrderStatus(cfg, id, status);
      return {
        content: [{ type: "text", text: JSON.stringify(order, null, 2) }],
      };
    },
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "4mb" }));

const transports = new Map<string, StreamableHTTPServerTransport>();

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "woocommerce-mcp" });
});

app.post("/mcp", async (req, res) => {
  try {
    const cfg = requireConfig();
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (transport) {
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
        },
      });
      transport.onclose = () => {
        const id = transport!.sessionId;
        if (id) transports.delete(id);
      };
      const server = createServer(cfg);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: missing or invalid session" },
      id: null,
    });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : "Internal error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transport.handleRequest(req, res);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`woocommerce-mcp listening on :${PORT}`);
});
