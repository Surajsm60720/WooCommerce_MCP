import { Router } from "express";
import { z } from "zod";
import { generateApiKey, hashPassword, publicUser } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { requireJwt, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { dropSessionsForApiKey } from "../mcp/gatewayMcp.js";
import { config } from "../lib/config.js";

export const teamRouter = Router();
export const keysRouter = Router();

teamRouter.use(requireJwt);
keysRouter.use(requireJwt);

teamRouter.get("/members", requireRole("admin"), async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  res.json(users.map(publicUser));
});

teamRouter.post("/invite", requireRole("admin"), async (req, res) => {
  const body = z
    .object({
      email: z.string().email(),
      name: z.string().min(1),
      password: z.string().min(8),
      role: z.enum(["admin", "member"]).default("member"),
    })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const exists = await prisma.user.findUnique({ where: { email: body.data.email } });
  if (exists) {
    res.status(409).json({ error: "User already exists" });
    return;
  }
  const user = await prisma.user.create({
    data: {
      email: body.data.email,
      name: body.data.name,
      role: body.data.role,
      passwordHash: await hashPassword(body.data.password),
    },
  });
  res.status(201).json(publicUser(user));
});

keysRouter.get("/", async (req: AuthedRequest, res) => {
  const keys = await prisma.apiKey.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "desc" },
  });
  res.json(
    keys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
    })),
  );
});

keysRouter.post("/", async (req: AuthedRequest, res) => {
  const body = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const { raw, prefix, keyHash } = generateApiKey();
  const key = await prisma.apiKey.create({
    data: {
      userId: req.user!.id,
      name: body.data.name,
      prefix,
      keyHash,
    },
  });
  res.status(201).json({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    key: raw,
    createdAt: key.createdAt,
    mcpUrl: `${config.publicGatewayUrl.replace(/\/$/, "")}/mcp`,
  });
});

keysRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const key = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
  if (!key) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Members revoke own keys; admins can revoke any
  if (key.userId !== req.user!.id && req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await prisma.apiKey.update({
    where: { id: key.id },
    data: { revokedAt: new Date() },
  });
  dropSessionsForApiKey(key.id);
  res.status(204).end();
});

// Admin revoke by user
teamRouter.get("/keys", requireRole("admin"), async (_req, res) => {
  const keys = await prisma.apiKey.findMany({
    where: { revokedAt: null },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(
    keys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      createdAt: k.createdAt,
      userEmail: k.user.email,
      userName: k.user.name,
    })),
  );
});

teamRouter.post("/keys/:id/revoke", requireRole("admin"), async (req, res) => {
  const existing = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await prisma.apiKey.update({
    where: { id: req.params.id },
    data: { revokedAt: new Date() },
  });
  dropSessionsForApiKey(existing.id);
  res.status(204).end();
});

