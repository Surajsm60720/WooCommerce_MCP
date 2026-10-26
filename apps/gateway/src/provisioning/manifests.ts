import type { KubernetesObject } from "@kubernetes/client-node";
import { multiStoreConfig } from "./config.js";
import type { StoreSecrets } from "./secrets.js";

export type StoreIdentity = {
  slug: string;
  name: string;
  namespace: string;
  host: string;
};

const LABELS = (slug: string, component: string) => ({
  "app.kubernetes.io/name": "woo-store",
  "app.kubernetes.io/instance": slug,
  "app.kubernetes.io/component": component,
  "store.mcp-platform.io/slug": slug,
  "store.mcp-platform.io/managed": "true",
});

function bootstrapScript(host: string, storeTitle: string): string {
  return `#!/bin/sh
set -eu
export WP_CLI_ALLOW_ROOT=1
cd /var/www/html
mkdir -p wp-content/upgrade wp-content/plugins wp-content/uploads
chown -R www-data:www-data wp-content || true
chmod -R ug+rwX wp-content || true

echo "Waiting for wp-config.php..."
i=0
while [ ! -f wp-config.php ]; do
  i=$((i+1))
  if [ "$i" -gt 60 ]; then
    echo "Timeout waiting for wp-config.php"
    exit 1
  fi
  sleep 5
done

if ! wp core is-installed; then
  echo "Installing WordPress..."
  wp core install \\
    --url="http://${host}" \\
    --title="${storeTitle.replace(/"/g, "")}" \\
    --admin_user="$WORDPRESS_ADMIN_USER" \\
    --admin_password="$WORDPRESS_ADMIN_PASSWORD" \\
    --admin_email="$WORDPRESS_ADMIN_EMAIL" \\
    --skip-email
fi

echo "Ensuring WooCommerce..."
if ! wp plugin is-installed woocommerce; then
  wp plugin install woocommerce --version=9.6.2 --activate
else
  wp plugin activate woocommerce || true
fi

wp option update woocommerce_store_address "1 Demo Street"
wp option update woocommerce_store_city "Demo City"
wp option update woocommerce_default_country "US:CA"
wp option update woocommerce_currency "USD"
wp option update woocommerce_cod_settings '{"enabled":"yes","title":"Cash on delivery","description":"Pay with cash upon delivery.","instructions":"Pay with cash upon delivery.","enable_for_methods":[],"enable_for_virtual":"yes"}' --format=json || true
wp option update woocommerce_coming_soon no || true
wp option update woocommerce_store_pages_only no || true
wp wc tool run install_pages --user=1 || true

echo "Ensuring REST API key..."
wp eval '
  global $wpdb;
  $key = getenv("WOO_CONSUMER_KEY");
  $secret = getenv("WOO_CONSUMER_SECRET");
  if (!$key || !$secret) { echo "missing key env\\n"; exit(1); }
  $table = $wpdb->prefix . "woocommerce_api_keys";
  $exists = $wpdb->get_var($wpdb->prepare("SELECT key_id FROM {$table} WHERE truncated_key = %s", substr($key, -7)));
  if (!$exists) {
    $wpdb->insert($table, array(
      "user_id" => 1,
      "description" => "MCP Gateway",
      "permissions" => "read_write",
      "consumer_key" => wc_api_hash($key),
      "consumer_secret" => $secret,
      "truncated_key" => substr($key, -7),
    ));
    echo "API key inserted\\n";
  } else {
    echo "API key already present\\n";
  }
'

COUNT=$(wp post list --post_type=product --format=count)
if [ "$COUNT" = "0" ]; then
  wp wc product create --name="Starter Mug" --regular_price=12.00 --user=1 || true
fi

mkdir -p wp-content/mu-plugins
cat > wp-content/mu-plugins/wc-allow-http-basic-auth.php <<'PHP'
<?php
add_filter('woocommerce_api_is_ssl', '__return_true');
add_action('init', function () {
  if (!empty($_SERVER['HTTP_AUTHORIZATION']) || !empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION']) || !empty($_GET['consumer_key'])) {
    $_SERVER['HTTPS'] = 'on';
  }
}, 0);
PHP
chown -R www-data:www-data wp-content/mu-plugins || true
echo "Bootstrap complete"
`;
}

export function buildStoreManifests(
  id: StoreIdentity,
  secrets: StoreSecrets,
): KubernetesObject[] {
  const { namespace, slug, host, name } = id;
  const cfg = multiStoreConfig;
  const sc = cfg.storageClassName
    ? { storageClassName: cfg.storageClassName }
    : {};

  const objs: KubernetesObject[] = [];

  objs.push({
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      name: namespace,
      labels: {
        "store.mcp-platform.io/managed": "true",
        "store.mcp-platform.io/slug": slug,
      },
    },
  });

  objs.push({
    apiVersion: "v1",
    kind: "ResourceQuota",
    metadata: { name: "store-quota", namespace, labels: LABELS(slug, "quota") },
    spec: {
      hard: {
        "requests.cpu": "2",
        "requests.memory": "3Gi",
        "limits.cpu": "4",
        "limits.memory": "6Gi",
        persistentvolumeclaims: "4",
        pods: "12",
      },
    },
  } as KubernetesObject);

  objs.push({
    apiVersion: "v1",
    kind: "LimitRange",
    metadata: { name: "store-limits", namespace, labels: LABELS(slug, "limits") },
    spec: {
      limits: [
        {
          type: "Container",
          default: { cpu: "500m", memory: "512Mi" },
          defaultRequest: { cpu: "50m", memory: "64Mi" },
          max: { cpu: "2", memory: "2Gi" },
        },
      ],
    },
  } as KubernetesObject);

  objs.push({
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "store-secrets",
      namespace,
      labels: LABELS(slug, "secrets"),
    },
    type: "Opaque",
    stringData: {
      "mysql-root-password": secrets.mysqlRootPassword,
      "mysql-password": secrets.mysqlPassword,
      "mysql-user": secrets.mysqlUser,
      "mysql-database": secrets.mysqlDatabase,
      "wordpress-admin-user": secrets.wordpressAdminUser,
      "wordpress-admin-password": secrets.wordpressAdminPassword,
      "wordpress-admin-email": secrets.wordpressAdminEmail,
      "woo-consumer-key": secrets.wooConsumerKey,
      "woo-consumer-secret": secrets.wooConsumerSecret,
    },
  } as KubernetesObject);

  objs.push({
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: "mariadb-data",
      namespace,
      labels: LABELS(slug, "mariadb"),
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      ...sc,
      resources: { requests: { storage: "2Gi" } },
    },
  } as KubernetesObject);

  objs.push({
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: "wordpress-data",
      namespace,
      labels: LABELS(slug, "wordpress"),
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      ...sc,
      resources: { requests: { storage: "2Gi" } },
    },
  } as KubernetesObject);

  objs.push({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "mariadb", namespace, labels: LABELS(slug, "mariadb") },
    spec: {
      replicas: 1,
      selector: { matchLabels: LABELS(slug, "mariadb") },
      template: {
        metadata: { labels: LABELS(slug, "mariadb") },
        spec: {
          containers: [
            {
              name: "mariadb",
              image: cfg.images.mariadb,
              imagePullPolicy: cfg.imagePullPolicy,
              ports: [{ containerPort: 3306 }],
              env: [
                {
                  name: "MARIADB_ROOT_PASSWORD",
                  valueFrom: {
                    secretKeyRef: {
                      name: "store-secrets",
                      key: "mysql-root-password",
                    },
                  },
                },
                {
                  name: "MARIADB_DATABASE",
                  valueFrom: {
                    secretKeyRef: {
                      name: "store-secrets",
                      key: "mysql-database",
                    },
                  },
                },
                {
                  name: "MARIADB_USER",
                  valueFrom: {
                    secretKeyRef: { name: "store-secrets", key: "mysql-user" },
                  },
                },
                {
                  name: "MARIADB_PASSWORD",
                  valueFrom: {
                    secretKeyRef: {
                      name: "store-secrets",
                      key: "mysql-password",
                    },
                  },
                },
              ],
              volumeMounts: [{ name: "data", mountPath: "/var/lib/mysql" }],
              readinessProbe: {
                exec: {
                  command: [
                    "healthcheck.sh",
                    "--connect",
                    "--innodb_initialized",
                  ],
                },
                initialDelaySeconds: 20,
                periodSeconds: 10,
              },
              resources: {
                requests: { cpu: "100m", memory: "256Mi" },
                limits: { cpu: "1", memory: "1Gi" },
              },
            },
          ],
          volumes: [
            { name: "data", persistentVolumeClaim: { claimName: "mariadb-data" } },
          ],
        },
      },
    },
  } as KubernetesObject);

  objs.push({
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "mariadb", namespace, labels: LABELS(slug, "mariadb") },
    spec: {
      selector: LABELS(slug, "mariadb"),
      ports: [{ port: 3306, targetPort: 3306 }],
    },
  } as KubernetesObject);

  objs.push({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "wordpress", namespace, labels: LABELS(slug, "wordpress") },
    spec: {
      replicas: 1,
      selector: { matchLabels: LABELS(slug, "wordpress") },
      template: {
        metadata: { labels: LABELS(slug, "wordpress") },
        spec: {
          containers: [
            {
              name: "wordpress",
              image: cfg.images.wordpress,
              imagePullPolicy: cfg.imagePullPolicy,
              ports: [{ containerPort: 80 }],
              env: [
                { name: "WORDPRESS_DB_HOST", value: "mariadb" },
                {
                  name: "WORDPRESS_DB_USER",
                  valueFrom: {
                    secretKeyRef: { name: "store-secrets", key: "mysql-user" },
                  },
                },
                {
                  name: "WORDPRESS_DB_PASSWORD",
                  valueFrom: {
                    secretKeyRef: {
                      name: "store-secrets",
                      key: "mysql-password",
                    },
                  },
                },
                {
                  name: "WORDPRESS_DB_NAME",
                  valueFrom: {
                    secretKeyRef: {
                      name: "store-secrets",
                      key: "mysql-database",
                    },
                  },
                },
              ],
              volumeMounts: [
                { name: "data", mountPath: "/var/www/html" },
              ],
              readinessProbe: {
                httpGet: { path: "/wp-login.php", port: 80 },
                initialDelaySeconds: 30,
                periodSeconds: 10,
              },
              resources: {
                requests: { cpu: "100m", memory: "256Mi" },
                limits: { cpu: "1", memory: "1Gi" },
              },
            },
          ],
          volumes: [
            {
              name: "data",
              persistentVolumeClaim: { claimName: "wordpress-data" },
            },
          ],
        },
      },
    },
  } as KubernetesObject);

  objs.push({
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "wordpress", namespace, labels: LABELS(slug, "wordpress") },
    spec: {
      selector: LABELS(slug, "wordpress"),
      ports: [{ port: 80, targetPort: 80 }],
    },
  } as KubernetesObject);

  objs.push({
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: "wordpress-bootstrap",
      namespace,
      labels: LABELS(slug, "wordpress-bootstrap"),
    },
    data: { "bootstrap.sh": bootstrapScript(host, name) },
  } as KubernetesObject);

  objs.push({
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: "wordpress-bootstrap",
      namespace,
      labels: LABELS(slug, "wordpress-bootstrap"),
    },
    spec: {
      backoffLimit: 8,
      template: {
        metadata: { labels: LABELS(slug, "wordpress-bootstrap") },
        spec: {
          restartPolicy: "OnFailure",
          securityContext: { runAsUser: 0 },
          containers: [
            {
              name: "bootstrap",
              image: cfg.images.wordpressCli,
              imagePullPolicy: cfg.imagePullPolicy,
              command: ["sh", "/scripts/bootstrap.sh"],
              resources: {
                requests: { cpu: "50m", memory: "128Mi" },
                limits: { cpu: "500m", memory: "512Mi" },
              },
              env: [
                { name: "WORDPRESS_DB_HOST", value: "mariadb" },
                {
                  name: "WORDPRESS_DB_USER",
                  valueFrom: {
                    secretKeyRef: { name: "store-secrets", key: "mysql-user" },
                  },
                },
                {
                  name: "WORDPRESS_DB_PASSWORD",
                  valueFrom: {
                    secretKeyRef: {
                      name: "store-secrets",
                      key: "mysql-password",
                    },
                  },
                },
                {
                  name: "WORDPRESS_DB_NAME",
                  valueFrom: {
                    secretKeyRef: {
                      name: "store-secrets",
                      key: "mysql-database",
                    },
                  },
                },
                {
                  name: "WORDPRESS_ADMIN_USER",
                  valueFrom: {
                    secretKeyRef: {
                      name: "store-secrets",
                      key: "wordpress-admin-user",
                    },
                  },
                },
                {
                  name: "WORDPRESS_ADMIN_PASSWORD",
                  valueFrom: {
                    secretKeyRef: {
                      name: "store-secrets",
                      key: "wordpress-admin-password",
                    },
                  },
                },
                {
                  name: "WORDPRESS_ADMIN_EMAIL",
                  valueFrom: {
                    secretKeyRef: {
                      name: "store-secrets",
                      key: "wordpress-admin-email",
                    },
                  },
                },
                {
                  name: "WOO_CONSUMER_KEY",
                  valueFrom: {
                    secretKeyRef: {
                      name: "store-secrets",
                      key: "woo-consumer-key",
                    },
                  },
                },
                {
                  name: "WOO_CONSUMER_SECRET",
                  valueFrom: {
                    secretKeyRef: {
                      name: "store-secrets",
                      key: "woo-consumer-secret",
                    },
                  },
                },
              ],
              volumeMounts: [
                { name: "data", mountPath: "/var/www/html" },
                { name: "scripts", mountPath: "/scripts" },
              ],
            },
          ],
          volumes: [
            {
              name: "data",
              persistentVolumeClaim: { claimName: "wordpress-data" },
            },
            {
              name: "scripts",
              configMap: {
                name: "wordpress-bootstrap",
                defaultMode: 0o755,
              },
            },
          ],
        },
      },
    },
  } as KubernetesObject);

  objs.push({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: "woocommerce-mcp",
      namespace,
      labels: LABELS(slug, "woocommerce-mcp"),
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: LABELS(slug, "woocommerce-mcp") },
      template: {
        metadata: { labels: LABELS(slug, "woocommerce-mcp") },
        spec: {
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 1000,
            fsGroup: 1000,
          },
          containers: [
            {
              name: "woocommerce-mcp",
              image: cfg.images.woocommerceMcp,
              imagePullPolicy: cfg.imagePullPolicy,
              ports: [{ containerPort: 3101 }],
              env: [
                { name: "PORT", value: "3101" },
                { name: "WOOCOMMERCE_URL", value: "http://wordpress" },
                {
                  name: "WOOCOMMERCE_CONSUMER_KEY",
                  valueFrom: {
                    secretKeyRef: {
                      name: "store-secrets",
                      key: "woo-consumer-key",
                    },
                  },
                },
                {
                  name: "WOOCOMMERCE_CONSUMER_SECRET",
                  valueFrom: {
                    secretKeyRef: {
                      name: "store-secrets",
                      key: "woo-consumer-secret",
                    },
                  },
                },
              ],
              readinessProbe: {
                httpGet: { path: "/healthz", port: 3101 },
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
              resources: {
                requests: { cpu: "50m", memory: "128Mi" },
                limits: { cpu: "500m", memory: "256Mi" },
              },
            },
          ],
        },
      },
    },
  } as KubernetesObject);

  objs.push({
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: "woocommerce-mcp",
      namespace,
      labels: LABELS(slug, "woocommerce-mcp"),
    },
    spec: {
      selector: LABELS(slug, "woocommerce-mcp"),
      ports: [{ port: 3101, targetPort: 3101 }],
    },
  } as KubernetesObject);

  objs.push({
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: {
      name: "storefront",
      namespace,
      labels: LABELS(slug, "ingress"),
    },
    spec: {
      ingressClassName: cfg.ingressClassName,
      rules: [
        {
          host,
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  service: { name: "wordpress", port: { number: 80 } },
                },
              },
            ],
          },
        },
      ],
    },
  } as KubernetesObject);

  // NetworkPolicies — isolation
  objs.push({
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: "default-deny-ingress",
      namespace,
      labels: LABELS(slug, "netpol"),
    },
    spec: { podSelector: {}, policyTypes: ["Ingress"] },
  } as KubernetesObject);

  objs.push({
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: "allow-wordpress-ingress",
      namespace,
      labels: LABELS(slug, "netpol"),
    },
    spec: {
      podSelector: { matchLabels: LABELS(slug, "wordpress") },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": cfg.ingressNamespace,
                },
              },
            },
            { podSelector: { matchLabels: LABELS(slug, "woocommerce-mcp") } },
          ],
          ports: [{ protocol: "TCP", port: 80 }],
        },
      ],
    },
  } as KubernetesObject);

  objs.push({
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: "allow-mariadb",
      namespace,
      labels: LABELS(slug, "netpol"),
    },
    spec: {
      podSelector: { matchLabels: LABELS(slug, "mariadb") },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            { podSelector: { matchLabels: LABELS(slug, "wordpress") } },
            {
              podSelector: { matchLabels: LABELS(slug, "wordpress-bootstrap") },
            },
          ],
          ports: [{ protocol: "TCP", port: 3306 }],
        },
      ],
    },
  } as KubernetesObject);

  objs.push({
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: "allow-mcp-from-gateway",
      namespace,
      labels: LABELS(slug, "netpol"),
    },
    spec: {
      podSelector: { matchLabels: LABELS(slug, "woocommerce-mcp") },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": cfg.platformNamespace,
                },
              },
              podSelector: {
                matchLabels: { "app.kubernetes.io/component": "gateway" },
              },
            },
          ],
          ports: [{ protocol: "TCP", port: 3101 }],
        },
      ],
    },
  } as KubernetesObject);

  return objs;
}
