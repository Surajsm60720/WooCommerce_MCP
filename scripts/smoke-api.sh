#!/usr/bin/env bash
# Smoke-test gateway REST + MCP against a running cluster (port-forward or ingress).
set -euo pipefail
BASE="${BASE_URL:-http://gateway.local}"
AVA_EMAIL="${AVA_EMAIL:-ava@demo.local}"
AVA_PASS="${AVA_PASS:-AvaAdmin123!}"
BEN_EMAIL="${BEN_EMAIL:-ben@demo.local}"
BEN_PASS="${BEN_PASS:-BenMember123!}"

echo "==> Login Ava"
AVA_JSON=$(curl -fsS -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$AVA_EMAIL\",\"password\":\"$AVA_PASS\"}")
AVA_TOKEN=$(echo "$AVA_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

echo "==> List servers"
curl -fsS "$BASE/api/servers" -H "Authorization: Bearer $AVA_TOKEN" | python3 -m json.tool | head -60

echo "==> Login Ben + create key"
BEN_JSON=$(curl -fsS -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$BEN_EMAIL\",\"password\":\"$BEN_PASS\"}")
BEN_TOKEN=$(echo "$BEN_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
KEY_JSON=$(curl -fsS -X POST "$BASE/api/keys" \
  -H "Authorization: Bearer $BEN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"smoke"}')
BEN_KEY=$(echo "$KEY_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["key"])')
echo "Ben key prefix: ${BEN_KEY:0:12}..."

echo "==> MCP initialize as Ben"
INIT=$(curl -fsS -X POST "$BASE/mcp" \
  -H "Authorization: Bearer $BEN_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}')
echo "$INIT" | head -c 400
echo

echo "Smoke checks finished."
