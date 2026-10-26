import * as k8s from "@kubernetes/client-node";

let kubeConfig: k8s.KubeConfig | null = null;

export function getKubeConfig(): k8s.KubeConfig {
  if (kubeConfig) return kubeConfig;
  const kc = new k8s.KubeConfig();
  try {
    kc.loadFromCluster();
  } catch {
    kc.loadFromDefault();
  }
  kubeConfig = kc;
  return kc;
}

export function coreApi(): k8s.CoreV1Api {
  return getKubeConfig().makeApiClient(k8s.CoreV1Api);
}

export function appsApi(): k8s.AppsV1Api {
  return getKubeConfig().makeApiClient(k8s.AppsV1Api);
}

export function batchApi(): k8s.BatchV1Api {
  return getKubeConfig().makeApiClient(k8s.BatchV1Api);
}

export function netApi(): k8s.NetworkingV1Api {
  return getKubeConfig().makeApiClient(k8s.NetworkingV1Api);
}

export function objectApi(): k8s.KubernetesObjectApi {
  return k8s.KubernetesObjectApi.makeApiClient(getKubeConfig());
}

/** Surface Kubernetes HttpError body.message instead of bare "HTTP request failed". */
export function formatK8sError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as {
    message?: string;
    statusCode?: number;
    body?: { message?: string; reason?: string };
  };
  const detail = e.body?.message || e.message || String(err);
  if (e.statusCode) return `Kubernetes ${e.statusCode}: ${detail}`;
  return detail;
}

/** Kinds we never replace on conflict — recreate is handled elsewhere or leave as-is. */
const SKIP_REPLACE_ON_CONFLICT = new Set([
  "Namespace",
  "Job",
  "PersistentVolumeClaim",
  // Never rotate credentials under a live MariaDB PVC
  "Secret",
]);

export async function applyObject(obj: k8s.KubernetesObject): Promise<void> {
  const client = objectApi();
  const name = obj.metadata?.name;
  const kind = obj.kind ?? "Unknown";
  if (!name) throw new Error(`Manifest missing metadata.name (${kind})`);
  try {
    await client.create(obj);
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status !== 409) {
      throw new Error(
        `Failed to create ${kind}/${name}: ${formatK8sError(err)}`,
      );
    }
    // Already exists: skip kinds that are immutable or don't need updates on retry
    if (SKIP_REPLACE_ON_CONFLICT.has(kind)) return;
    try {
      const header = {
        apiVersion: obj.apiVersion!,
        kind,
        metadata: {
          name,
          namespace: obj.metadata?.namespace,
        },
      };
      const existing = await client.read(header);
      const body = {
        ...obj,
        metadata: {
          ...obj.metadata,
          name,
          resourceVersion: existing.body.metadata?.resourceVersion,
        },
      };
      await client.replace(body);
    } catch (replaceErr: unknown) {
      throw new Error(
        `Failed to update ${kind}/${name}: ${formatK8sError(replaceErr)}`,
      );
    }
  }
}

/** Delete a Job and wait until it is gone so a recreate is not racing finalizers. */
export async function deleteJobIfExists(
  namespace: string,
  name: string,
  timeoutMs = 60_000,
): Promise<void> {
  const api = batchApi();
  try {
    await api.deleteNamespacedJob(
      name,
      namespace,
      undefined,
      undefined,
      0,
      undefined,
      "Foreground",
    );
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404) return;
    throw new Error(
      `Failed to delete job ${name}: ${formatK8sError(err)}`,
    );
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await api.readNamespacedJob(name, namespace);
      await sleep(1000);
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404) return;
      throw new Error(
        `Failed while waiting for job ${name} deletion: ${formatK8sError(err)}`,
      );
    }
  }
  throw new Error(`Timed out waiting for job ${name} to be deleted`);
}

export async function deleteNamespace(name: string): Promise<void> {
  const api = coreApi();
  try {
    await api.deleteNamespace(name);
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404) return;
    throw err;
  }
}

export async function waitForNamespaceGone(
  name: string,
  timeoutMs: number,
): Promise<void> {
  const api = coreApi();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await api.readNamespace(name);
      await sleep(2000);
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404) return;
      throw err;
    }
  }
  throw new Error(`Timed out waiting for namespace ${name} to be deleted`);
}

export async function waitForJobComplete(
  namespace: string,
  name: string,
  timeoutMs: number,
): Promise<void> {
  const api = batchApi();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // Prefer full Job get (resource "jobs") over jobs/status subresource.
      const res = await api.readNamespacedJob(name, namespace);
      const status = res.body.status;
      if (status?.succeeded && status.succeeded > 0) return;
      const failedCond = status?.conditions?.some(
        (c) => c.type === "Failed" && c.status === "True",
      );
      if (failedCond) {
        throw new Error(`Bootstrap job ${name} failed in ${namespace}`);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith("Bootstrap job")) {
        throw err;
      }
      const statusCode = (err as { statusCode?: number }).statusCode;
      // Job may not be visible yet right after create
      if (statusCode !== 404) {
        throw new Error(`Waiting for job ${name}: ${formatK8sError(err)}`);
      }
    }
    await sleep(5000);
  }
  throw new Error(`Timed out waiting for job ${name} in ${namespace}`);
}

export async function waitForDeploymentReady(
  namespace: string,
  name: string,
  timeoutMs: number,
): Promise<void> {
  const api = appsApi();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await api.readNamespacedDeployment(name, namespace);
    const ready = res.body.status?.readyReplicas ?? 0;
    const desired = res.body.spec?.replicas ?? 1;
    if (ready >= desired) return;
    await sleep(3000);
  }
  throw new Error(`Timed out waiting for deployment ${name} in ${namespace}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
