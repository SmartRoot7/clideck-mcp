#!/usr/bin/env bash
set -euo pipefail

: "${CLIDECK_MCP_BASE_URL:=http://127.0.0.1:8787}"

curl --fail --silent --show-error "$CLIDECK_MCP_BASE_URL/health" >/dev/null
curl --fail --silent --show-error "$CLIDECK_MCP_BASE_URL/ready" >/dev/null

response="$(
  curl --fail --silent --show-error \
    --request POST \
    --header 'content-type: application/json' \
    --header 'accept: application/json, text/event-stream' \
    --header 'mcp-protocol-version: 2025-11-25' \
    --data '{
      "jsonrpc": "2.0",
      "id": 1,
      "method": "tools/call",
      "params": {
        "name": "query_network_knowledge",
        "arguments": {
          "question": "show ip interface brief",
          "context": {
            "vendor": "Cisco",
            "model": "C9300",
            "operating_system": "IOS XE",
            "version": "17.9.4"
          }
        }
      }
    }' \
    "$CLIDECK_MCP_BASE_URL/mcp"
)"

command="$(printf '%s\n' "$response" | jq -r '.result.structuredContent.answers[0].command')"
if [[ "$command" != 'show ip interface brief' ]]; then
  printf 'Unexpected smoke-test result\n' >&2
  exit 1
fi
