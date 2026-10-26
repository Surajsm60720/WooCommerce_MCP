export const multiStoreConfig = {
  enabled: (process.env.MULTI_STORE_ENABLED ?? "true").toLowerCase() !== "false",
  maxStoresPerUser: Number(process.env.MAX_STORES_PER_USER ?? 3),
  provisionTimeoutMs: Number(process.env.STORE_PROVISION_TIMEOUT_MS ?? 15 * 60_000),
  platformNamespace: process.env.PLATFORM_NAMESPACE ?? "mcp-platform",
  hostSuffix: process.env.STORE_HOST_SUFFIX ?? ".local",
  ingressClassName: process.env.INGRESS_CLASS_NAME ?? "nginx",
  ingressNamespace: process.env.INGRESS_NAMESPACE ?? "ingress-nginx",
  storageClassName: process.env.STORAGE_CLASS_NAME ?? "",
  images: {
    wordpress: process.env.IMAGE_WORDPRESS ?? "wordpress:6.7-php8.2-apache",
    wordpressCli: process.env.IMAGE_WORDPRESS_CLI ?? "wordpress:cli-php8.2",
    mariadb: process.env.IMAGE_MARIADB ?? "mariadb:11.4",
    woocommerceMcp:
      process.env.IMAGE_WOOCOMMERCE_MCP ?? "mcp-platform/woocommerce-mcp:local",
  },
  imagePullPolicy: process.env.IMAGE_PULL_POLICY ?? "IfNotPresent",
};

export function storeNamespace(slug: string): string {
  return `store-${slug}`;
}

export function storeHost(slug: string): string {
  return `store-${slug}${multiStoreConfig.hostSuffix}`;
}

export function storeMcpSlug(slug: string): string {
  return `woo-${slug}`;
}

export function storeMcpUrl(slug: string): string {
  const ns = storeNamespace(slug);
  return `http://woocommerce-mcp.${ns}.svc.cluster.local:3101/mcp`;
}
