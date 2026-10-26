#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-mcp-platform}"
GROQ_API_KEY="${GROQ_API_KEY:-}"

if ! command -v kind >/dev/null; then
  echo "kind is required: https://kind.sigs.k8s.io/"
  exit 1
fi
if ! command -v helm >/dev/null; then
  echo "helm is required: https://helm.sh/"
  exit 1
fi
if ! command -v kubectl >/dev/null; then
  echo "kubectl is required"
  exit 1
fi

if ! kind get clusters | grep -qx "$CLUSTER_NAME"; then
  cat <<EOF | kind create cluster --name "$CLUSTER_NAME" --config=-
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraPortMappings:
      - containerPort: 80
        hostPort: 80
        protocol: TCP
      - containerPort: 443
        hostPort: 443
        protocol: TCP
EOF
fi

echo "==> Installing ingress-nginx"
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=180s

echo "==> Building and loading images"
"$ROOT/scripts/build-images.sh"
for img in \
  mcp-platform/gateway:local \
  mcp-platform/dashboard:local \
  mcp-platform/woocommerce-mcp:local \
  mcp-platform/time-mcp:local \
  mcp-platform/notes-mcp:local \
  wordpress:6.7-php8.2-apache \
  wordpress:cli-php8.2 \
  mariadb:11.4 \
  postgres:16-alpine
do
  echo "  loading $img"
  kind load docker-image "$img" --name "$CLUSTER_NAME"
done

kubectl create namespace mcp-platform --dry-run=client -o yaml | kubectl apply -f -

SECRETS_FILE="$ROOT/charts/mcp-platform/secrets.local.yaml"
if [ ! -f "$SECRETS_FILE" ]; then
  SECRETS_FILE="$ROOT/charts/mcp-platform/secrets.example.yaml"
fi
echo "==> Using secrets file: $SECRETS_FILE"

EXTRA_SET=()
if [ -n "$GROQ_API_KEY" ]; then
  EXTRA_SET+=(--set "secrets.groqApiKey=${GROQ_API_KEY}")
fi

echo "==> Helm install"
helm upgrade --install mcp-platform "$ROOT/charts/mcp-platform" \
  --namespace mcp-platform \
  -f "$ROOT/charts/mcp-platform/values.yaml" \
  -f "$ROOT/charts/mcp-platform/values-local.yaml" \
  -f "$SECRETS_FILE" \
  "${EXTRA_SET[@]}"

echo "==> Waiting for core pods"
kubectl -n mcp-platform rollout status deploy/gateway --timeout=300s || true
kubectl -n mcp-platform rollout status deploy/dashboard --timeout=180s || true
kubectl -n mcp-platform rollout status deploy/wordpress --timeout=300s || true

echo "==> Waiting for WordPress bootstrap Job"
kubectl -n mcp-platform wait --for=condition=complete job/wordpress-bootstrap --timeout=600s \
  || kubectl -n mcp-platform logs job/wordpress-bootstrap --tail=80 || true

cat <<EOF

Cluster is up.

Add to /etc/hosts (pointing at 127.0.0.1 because Kind maps node ports 80/443):
  127.0.0.1 store.local dashboard.local gateway.local

URLs:
  Store:      http://store.local
  Dashboard:  http://dashboard.local
  Gateway MCP: http://gateway.local/mcp

Personas (from secrets file — defaults in secrets.example.yaml):
  Ava Admin  ava@demo.local / AvaAdmin123!
  Ben Member ben@demo.local / BenMember123!

WP admin: http://store.local/wp-admin  (see secrets.wordpressAdmin*)

If GROQ_API_KEY was not set, export it and re-run:
  GROQ_API_KEY=... $0
EOF
