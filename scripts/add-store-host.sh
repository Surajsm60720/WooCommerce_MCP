#!/usr/bin/env bash
# Add a provisioned store hostname to /etc/hosts (Kind local demos).
# Usage: ./scripts/add-store-host.sh store-harbor-south.local
set -euo pipefail
HOST="${1:-}"
if [ -z "$HOST" ]; then
  echo "Usage: $0 <hostname>   e.g. $0 store-harbor-south.local"
  exit 1
fi
LINE="127.0.0.1 ${HOST}"
if grep -qE "[[:space:]]${HOST}([[:space:]]|$)" /etc/hosts; then
  echo "Already present in /etc/hosts: ${HOST}"
  exit 0
fi
echo "Adding: ${LINE}"
echo "${LINE}" | sudo tee -a /etc/hosts >/dev/null
echo "Done. Open http://${HOST}/ and http://${HOST}/wp-admin"
