import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireJwt, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { getMetricsSummary } from "../services/metrics.js";
import { assertSafeUpstreamUrl } from "../services/ssrf.js";
import {
  refreshAllServers,
  refreshServerStatus,
  slugify,
  toPublicServer,
} from "../services/servers.js";

export const serversRouter = Router();

serversRouter.use(requireJwt);

serversRouter.get("/", async (_req, res) => {
  const servers = await prisma.mcpServer.findMany({ orderBy: { name: "asc" } });
  res.json(servers.map(toPublicServer));
});

serversRouter.get("/metrics-summary", async (_req, res) => {
  res.json(getMetricsSummary());
});

/** Any logged-in user can refresh status so Unreachable is demo-visible without waiting. */
serversRouter.post("/refresh", async (_req, res) => {
  await refreshAllServers();
  const servers = await prisma.mcpServer.findMany({ orderBy: { name: "asc" } });
  res.json(servers.map(toPublicServer));
});

serversRouter.post("/", requireRole("admin"), async (req: AuthedRequest, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      url: z.string().url(),
      credentialType: z.enum(["none", "bearer", "header"]).default("none"),
      credentialHeader: z.string().optional(),
      credentialValue: z.string().optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() });
    return;
  }

  try {
    assertSafeUpstreamUrl(body.data.url);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Unsafe upstream URL",
    });
    return;
  }

  let slug = slugify(body.data.name);
  const existing = await prisma.mcpServer.findUnique({ where: { slug } });
  if (existing) slug = `${slug}-${Date.now().toString(36)}`;

  const created = await prisma.mcpServer.create({
    data: {
      name: body.data.name,
      slug,
      url: body.data.url,
      credentialType: body.data.credentialType,
      credentialHeader: body.data.credentialHeader,
      credentialValue: body.data.credentialValue,
      enabled: true,
    },
  });
  const probed = await refreshServerStatus(created.id);
  res.status(201).json(toPublicServer(probed ?? created));
});

serversRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const body = z
    .object({
      name: z.string().min(1).optional(),
      url: z.string().url().optional(),
      enabled: z.boolean().optional(),
      credentialType: z.enum(["none", "bearer", "header"]).optional(),
      credentialHeader: z.string().nullable().optional(),
      credentialValue: z.string().nullable().optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  if (body.data.url) {
    try {
      assertSafeUpstreamUrl(body.data.url);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Unsafe upstream URL",
      });
      return;
    }
  }

  const data: Record<string, unknown> = { ...body.data };
  if (body.data.credentialValue === null) data.credentialValue = null;
  if (body.data.enabled === false) data.status = "disabled";

  const updated = await prisma.mcpServer.update({
    where: { id: req.params.id },
    data,
  });
  const probed = await refreshServerStatus(updated.id);
  res.json(toPublicServer(probed ?? updated));
});

serversRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  await prisma.mcpServer.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
