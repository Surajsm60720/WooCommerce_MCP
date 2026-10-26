#!/usr/bin/env bash
set -euo pipefail
CLUSTER_NAME="${CLUSTER_NAME:-mcp-platform}"
kind delete cluster --name "$CLUSTER_NAME"
