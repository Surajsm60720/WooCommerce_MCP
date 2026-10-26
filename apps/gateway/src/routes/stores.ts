import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireJwt, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { multiStoreConfig } from "../provisioning/config.js";
import { readExistingStoreSecrets } from "../provisioning/secrets.js";
import {
  createStoreRecord,
  deleteStore,
  runProvision,
  toPublicStore,
} from "../provisioning/provisioner.js";

export const storesRouter = Router();

storesRouter.use(requireJwt);

storesRouter.get("/", async (req: AuthedRequest, res) => {
  const isAdmin = req.user!.role === "admin";
  const stores = await prisma.store.findMany({
    where: isAdmin ? undefined : { createdById: req.user!.id },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { email: true, name: true } } },
  });
  res.json({
    enabled: multiStoreConfig.enabled,
    maxStoresPerUser: multiStoreConfig.maxStoresPerUser,
    stores: stores.map(toPublicStore),
  });
});

/** Admin-only: WordPress login for a provisioned store (credentials from K8s Secret). */
storesRouter.get(
  "/:id/access",
  requireRole("admin"),
  async (req: AuthedRequest, res) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.id } });
    if (!store) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (store.status !== "ready") {
      res.status(400).json({ error: "Store is not ready yet" });
      return;
    }
    try {
      const secrets = await readExistingStoreSecrets(store.namespace);
      if (!secrets) {
        res.status(404).json({ error: "Store secrets not found in cluster" });
        return;
      }
      res.json({
        url: `http://${store.host}`,
        wpAdminUrl: `http://${store.host}/wp-admin`,
        hostsLine: `127.0.0.1 ${store.host}`,
        adminUser: secrets.wordpressAdminUser,
        adminPassword: secrets.wordpressAdminPassword,
        adminEmail: secrets.wordpressAdminEmail,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Could not load store access",
      });
    }
  },
);

storesRouter.post("/", requireRole("admin"), async (req: AuthedRequest, res) => {
  if (!multiStoreConfig.enabled) {
    res.status(503).json({ error: "Multi-store provisioning is disabled" });
    return;
  }
  const body = z.object({ name: z.string().min(2).max(64) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "name is required (2–64 chars)" });
    return;
  }
  try {
    const store = await createStoreRecord({
      name: body.data.name,
      userId: req.user!.id,
    });
    const full = await prisma.store.findUniqueOrThrow({
      where: { id: store.id },
      include: { createdBy: { select: { email: true, name: true } } },
    });
    res.status(202).json(toPublicStore(full));
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Could not create store",
    });
  }
});

storesRouter.post(
  "/:id/retry",
  requireRole("admin"),
  async (req: AuthedRequest, res) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.id } });
    if (!store) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (store.status !== "failed" && store.status !== "provisioning") {
      res.status(400).json({ error: "Only failed/provisioning stores can be retried" });
      return;
    }
    await prisma.store.update({
      where: { id: store.id },
      data: {
        status: "provisioning",
        statusReason: "Retry requested",
      },
    });
    void runProvision(store.id);
    res.json({ ok: true });
  },
);

storesRouter.delete("/:id", requireRole("admin"), async (req: AuthedRequest, res) => {
  try {
    await deleteStore(req.params.id, req.user!.id, true);
    res.status(204).end();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    const code = message === "Store not found" ? 404 : 400;
    res.status(code).json({ error: message });
  }
});
