#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${TAG:-local}"

build() {
  local name="$1"
  local ctx="$2"
  echo "==> Building mcp-platform/${name}:${TAG}"
  docker build -t "mcp-platform/${name}:${TAG}" "$ctx"
}

build gateway "$ROOT/apps/gateway"
build dashboard "$ROOT/apps/dashboard"
build woocommerce-mcp "$ROOT/apps/woocommerce-mcp"
build time-mcp "$ROOT/apps/time-mcp"
build notes-mcp "$ROOT/apps/notes-mcp"

echo "Done. Images tagged mcp-platform/*:${TAG}"
