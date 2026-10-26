import { prisma } from "../lib/prisma.js";
import { refreshServerStatus, slugify } from "../services/servers.js";
import {
  multiStoreConfig,
  storeHost,
  storeMcpSlug,
  storeMcpUrl,
  storeNamespace,
} from "./config.js";
import {
  applyObject,
  deleteJobIfExists,
  deleteNamespace,
  formatK8sError,
  waitForDeploymentReady,
  waitForJobComplete,
  waitForNamespaceGone,
} from "./k8s.js";
import { buildStoreManifests } from "./manifests.js";
import {
  generateStoreSecrets,
  readExistingStoreSecrets,
} from "./secrets.js";

const inFlight = new Set<string>();

export function toPublicStore(store: {
  id: string;
  name: string;
  slug: string;
  namespace: string;
  host: string;
  status: string;
  statusReason: string | null;
  mcpServerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { email: string; name: string } | null;
}) {
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    namespace: store.namespace,
    host: store.host,
    url: `http://${store.host}`,
    wpAdminUrl: `http://${store.host}/wp-admin`,
    hostsLine: `127.0.0.1 ${store.host}`,
    status: store.status,
    statusReason: store.statusReason,
    mcpServerId: store.mcpServerId,
    mcpSlug: storeMcpSlug(store.slug),
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
    createdByEmail: store.createdBy?.email ?? null,
  };
}

export async function createStoreRecord(input: {
  name: string;
  userId: string;
}) {
  if (!multiStoreConfig.enabled) {
    throw new Error("Multi-store provisioning is disabled");
  }

  const count = await prisma.store.count({
    where: {
      createdById: input.userId,
      status: { notIn: ["failed"] },
    },
  });
  if (count >= multiStoreConfig.maxStoresPerUser) {
    throw new Error(
      `Maximum of ${multiStoreConfig.maxStoresPerUser} stores per user reached`,
    );
  }

  let slug = slugify(input.name);
  if (!slug) slug = `store-${Date.now().toString(36)}`;
  const existing = await prisma.store.findUnique({ where: { slug } });
  if (existing) slug = `${slug}-${Date.now().toString(36)}`;

  const store = await prisma.store.create({
    data: {
      name: input.name.trim(),
      slug,
      namespace: storeNamespace(slug),
      host: storeHost(slug),
      status: "provisioning",
      statusReason: "Creating namespace and workloads",
      createdById: input.userId,
    },
    include: { createdBy: { select: { email: true, name: true } } },
  });

  void runProvision(store.id);
  return store;
}

export async function runProvision(storeId: string): Promise<void> {
  if (inFlight.has(storeId)) return;
  inFlight.add(storeId);
  try {
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return;
    if (store.status !== "provisioning" && store.status !== "failed") return;

    await prisma.store.update({
      where: { id: storeId },
      data: {
        status: "provisioning",
        statusReason: "Applying Kubernetes manifests",
      },
    });

    // Reuse existing Secret on retry — regenerating breaks MariaDB PVC passwords
    const secrets =
      (await readExistingStoreSecrets(store.namespace)) ??
      generateStoreSecrets(store.slug);
    const manifests = buildStoreManifests(
      {
        slug: store.slug,
        name: store.name,
        namespace: store.namespace,
        host: store.host,
      },
      secrets,
    );

    // Idempotent retry: drop prior bootstrap Job and wait until gone
    await deleteJobIfExists(store.namespace, "wordpress-bootstrap");

    for (const obj of manifests) {
      await applyObject(obj);
    }

    await prisma.store.update({
      where: { id: storeId },
      data: { statusReason: "Waiting for WordPress / MariaDB / bootstrap" },
    });

    await waitForDeploymentReady(
      store.namespace,
      "mariadb",
      multiStoreConfig.provisionTimeoutMs,
    );
    await waitForDeploymentReady(
      store.namespace,
      "wordpress",
      multiStoreConfig.provisionTimeoutMs,
    );
    await waitForJobComplete(
      store.namespace,
      "wordpress-bootstrap",
      multiStoreConfig.provisionTimeoutMs,
    );
    await waitForDeploymentReady(
      store.namespace,
      "woocommerce-mcp",
      multiStoreConfig.provisionTimeoutMs,
    );

    const mcpSlug = storeMcpSlug(store.slug);
    const mcpUrl = storeMcpUrl(store.slug);

    let mcp = await prisma.mcpServer.findUnique({ where: { slug: mcpSlug } });
    if (!mcp) {
      mcp = await prisma.mcpServer.create({
        data: {
          name: `WooCommerce (${store.name})`,
          slug: mcpSlug,
          url: mcpUrl,
          credentialType: "none",
          enabled: true,
        },
      });
    } else {
      mcp = await prisma.mcpServer.update({
        where: { id: mcp.id },
        data: {
          name: `WooCommerce (${store.name})`,
          url: mcpUrl,
          enabled: true,
          status: "unreachable",
        },
      });
    }

    await refreshServerStatus(mcp.id);

    await prisma.store.update({
      where: { id: storeId },
      data: {
        status: "ready",
        statusReason: null,
        mcpServerId: mcp.id,
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : formatK8sError(err);
    console.error(`Store provision failed ${storeId}:`, message);
    await prisma.store.update({
      where: { id: storeId },
      data: { status: "failed", statusReason: message.slice(0, 500) },
    });
  } finally {
    inFlight.delete(storeId);
  }
}

export async function deleteStore(storeId: string, userId: string, isAdmin: boolean) {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw new Error("Store not found");
  if (!isAdmin && store.createdById !== userId) {
    throw new Error("Forbidden");
  }

  await prisma.store.update({
    where: { id: storeId },
    data: { status: "deleting", statusReason: "Tearing down namespace" },
  });

  if (store.mcpServerId) {
    try {
      await prisma.mcpServer.delete({ where: { id: store.mcpServerId } });
    } catch {
      /* already gone */
    }
  } else {
    const mcpSlug = storeMcpSlug(store.slug);
    await prisma.mcpServer.deleteMany({ where: { slug: mcpSlug } });
  }

  try {
    await deleteNamespace(store.namespace);
    await waitForNamespaceGone(store.namespace, 120_000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.store.update({
      where: { id: storeId },
      data: { status: "failed", statusReason: `Teardown: ${message}`.slice(0, 500) },
    });
    throw err;
  }

  await prisma.store.delete({ where: { id: storeId } });
}

/** Resume provisioning / fail timed-out stores after gateway restart. */
export async function reconcileStores(): Promise<void> {
  if (!multiStoreConfig.enabled) return;

  const stuck = await prisma.store.findMany({
    where: { status: { in: ["provisioning", "deleting"] } },
  });

  for (const store of stuck) {
    const age = Date.now() - store.updatedAt.getTime();
    if (store.status === "provisioning") {
      if (age > multiStoreConfig.provisionTimeoutMs) {
        await prisma.store.update({
          where: { id: store.id },
          data: {
            status: "failed",
            statusReason: "Provisioning timed out (gateway reconcile)",
          },
        });
      } else {
        console.log(`Resuming store provision: ${store.slug}`);
        void runProvision(store.id);
      }
    }
    if (store.status === "deleting" && age > 5 * 60_000) {
      await prisma.store.update({
        where: { id: store.id },
        data: {
          status: "failed",
          statusReason: "Delete timed out — namespace may need manual cleanup",
        },
      });
    }
  }
}
