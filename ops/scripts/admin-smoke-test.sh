#!/usr/bin/env bash
set -euo pipefail

: "${CLIDECK_MCP_ADMIN_URL:=https://clideck-mcp.lan}"
: "${CLIDECK_MCP_ADMIN_CA:?CLIDECK_MCP_ADMIN_CA must point to the local Caddy root certificate}"

health="$(
  curl \
    --fail \
    --silent \
    --show-error \
    --cacert "$CLIDECK_MCP_ADMIN_CA" \
    "$CLIDECK_MCP_ADMIN_URL/admin/health"
)"

if [[ "$(printf '%s\n' "$health" | jq -r '.service')" != 'clideck-mcp-admin' ]]; then
  printf 'Unexpected admin health payload\n' >&2
  exit 1
fi

status="$(
  curl \
    --silent \
    --output /dev/null \
    --write-out '%{http_code}' \
    --cacert "$CLIDECK_MCP_ADMIN_CA" \
    "$CLIDECK_MCP_ADMIN_URL/admin/api/v1/overview"
)"

if [[ "$status" != '401' ]]; then
  printf 'Unauthenticated admin API returned %s instead of 401\n' "$status" >&2
  exit 1
fi

html="$(
  curl \
    --fail \
    --silent \
    --show-error \
    --cacert "$CLIDECK_MCP_ADMIN_CA" \
    "$CLIDECK_MCP_ADMIN_URL/admin"
)"

if ! printf '%s\n' "$html" | grep -q 'CliDeck MCP'; then
  printf 'Admin SPA was not served\n' >&2
  exit 1
fi
