import { randomBytes } from "node:crypto";
import { coreApi, formatK8sError } from "./k8s.js";

export type StoreSecrets = {
  mysqlRootPassword: string;
  mysqlPassword: string;
  mysqlUser: string;
  mysqlDatabase: string;
  wordpressAdminUser: string;
  wordpressAdminPassword: string;
  wordpressAdminEmail: string;
  wooConsumerKey: string;
  wooConsumerSecret: string;
};

function token(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

export function generateStoreSecrets(slug: string): StoreSecrets {
  return {
    mysqlRootPassword: token(18),
    mysqlPassword: token(18),
    mysqlUser: "wordpress",
    mysqlDatabase: "wordpress",
    wordpressAdminUser: "admin",
    wordpressAdminPassword: `Store-${slug}-${token(8)}`,
    wordpressAdminEmail: `admin@store-${slug}.local`,
    wooConsumerKey: `ck_${token(20)}`,
    wooConsumerSecret: `cs_${token(20)}`,
  };
}

function decode(data: Record<string, string> | undefined, key: string): string | null {
  const raw = data?.[key];
  if (!raw) return null;
  return Buffer.from(raw, "base64").toString("utf8");
}

/**
 * Reuse credentials already applied to a store namespace.
 * Regenerating on retry rotates MariaDB passwords while the PVC still has the old ones.
 */
export async function readExistingStoreSecrets(
  namespace: string,
): Promise<StoreSecrets | null> {
  try {
    const res = await coreApi().readNamespacedSecret("store-secrets", namespace);
    const data = res.body.data;
    const required: (keyof StoreSecrets)[] = [
      "mysqlRootPassword",
      "mysqlPassword",
      "mysqlUser",
      "mysqlDatabase",
      "wordpressAdminUser",
      "wordpressAdminPassword",
      "wordpressAdminEmail",
      "wooConsumerKey",
      "wooConsumerSecret",
    ];
    const keyMap: Record<keyof StoreSecrets, string> = {
      mysqlRootPassword: "mysql-root-password",
      mysqlPassword: "mysql-password",
      mysqlUser: "mysql-user",
      mysqlDatabase: "mysql-database",
      wordpressAdminUser: "wordpress-admin-user",
      wordpressAdminPassword: "wordpress-admin-password",
      wordpressAdminEmail: "wordpress-admin-email",
      wooConsumerKey: "woo-consumer-key",
      wooConsumerSecret: "woo-consumer-secret",
    };
    const out = {} as StoreSecrets;
    for (const field of required) {
      const value = decode(data, keyMap[field]);
      if (!value) return null;
      out[field] = value;
    }
    return out;
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404) return null;
    throw new Error(
      `Failed to read store-secrets in ${namespace}: ${formatK8sError(err)}`,
    );
  }
}
