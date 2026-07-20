#!/usr/bin/env bash
set -euo pipefail

: "${CLIDECK_MCP_BASE_URL:=http://127.0.0.1:8787}"

curl_options=(
  --fail
  --silent
  --show-error
  --retry 3
  --retry-delay 2
  --retry-all-errors
)

printf 'smoke: health and readiness\n' >&2
curl "${curl_options[@]}" "$CLIDECK_MCP_BASE_URL/health" >/dev/null
curl "${curl_options[@]}" "$CLIDECK_MCP_BASE_URL/ready" >/dev/null

printf 'smoke: public statistics\n' >&2
stats="$(
  curl "${curl_options[@]}" \
    "$CLIDECK_MCP_BASE_URL/public/v1/stats"
)"
if [[ "$(printf '%s\n' "$stats" | jq -r '.coverage.published_knowledge >= 50')" != 'true' ]]; then
  printf 'Public statistics do not contain the 0.2 knowledge pack\n' >&2
  exit 1
fi

printf 'smoke: MCP tool discovery\n' >&2
tools="$(
  curl "${curl_options[@]}" \
    --request POST \
    --header 'content-type: application/json' \
    --header 'accept: application/json, text/event-stream' \
    --header 'mcp-protocol-version: 2025-11-25' \
    --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
    "$CLIDECK_MCP_BASE_URL/mcp"
)"
required_tools='[
  "list_knowledge_domains",
  "describe_knowledge_domain",
  "query_domain_knowledge",
  "resolve_network_context",
  "query_network_knowledge",
  "get_network_workflow",
  "request_expert_answer",
  "get_expert_task",
  "continue_expert_task",
  "cancel_expert_task",
  "submit_feedback",
  "analyze_device_snapshot",
  "review_network_change",
  "verify_network_change",
  "advise_network_upgrade",
  "analyze_network_path"
]'
if [[ "$(printf '%s\n' "$tools" | jq \
  --argjson required "$required_tools" \
  '[.result.tools[].name] as $actual |
   ($required | all(. as $name | $actual | index($name) != null))')" != 'true' ]]; then
  printf 'One or more required public MCP tools are missing\n' >&2
  exit 1
fi

printf 'smoke: deterministic knowledge retrieval\n' >&2
response="$(
  curl "${curl_options[@]}" \
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

printf 'smoke: snapshot redaction\n' >&2
snapshot="$(
  curl "${curl_options[@]}" \
    --request POST \
    --header 'content-type: application/json' \
    --header 'accept: application/json, text/event-stream' \
    --header 'mcp-protocol-version: 2025-11-25' \
    --data '{
      "jsonrpc":"2.0",
      "id":2,
      "method":"tools/call",
      "params":{
        "name":"analyze_device_snapshot",
        "arguments":{
          "snapshot":"Cisco IOS XE Software, Version 17.15.5\ncisco C9300-48P processor\nusername smoke secret 9 sentinel-smoke-secret",
          "snapshot_type":"auto",
          "redaction_profile":"strict"
        }
      }
    }' \
    "$CLIDECK_MCP_BASE_URL/mcp"
)"
if printf '%s\n' "$snapshot" | jq -e \
  '.result.structuredContent.sanitized_snapshot | contains("sentinel-smoke-secret")' \
  >/dev/null; then
  printf 'Snapshot redaction smoke test failed\n' >&2
  exit 1
fi

printf 'smoke: destructive-command advisory\n' >&2
change="$(
  curl "${curl_options[@]}" \
    --request POST \
    --header 'content-type: application/json' \
    --header 'accept: application/json, text/event-stream' \
    --header 'mcp-protocol-version: 2025-11-25' \
    --data '{
      "jsonrpc":"2.0",
      "id":3,
      "method":"tools/call",
      "params":{
        "name":"review_network_change",
        "arguments":{
          "intent":"Reload device",
          "context":{
            "vendor":"Cisco",
            "model":"C9300",
            "operating_system":"IOS XE",
            "version":"17.15.5"
          },
          "commands":["reload"]
        }
      }
    }' \
    "$CLIDECK_MCP_BASE_URL/mcp"
)"
if [[ "$(printf '%s\n' "$change" | jq -r '.result.structuredContent.decision')" != 'allowed_with_checks' ]]; then
  printf 'Dangerous change did not return advisory guidance\n' >&2
  exit 1
fi
if [[ "$(printf '%s\n' "$change" | jq -r '.result.structuredContent.risk_level')" != 'high' ]]; then
  printf 'Dangerous change was not classified as high risk\n' >&2
  exit 1
fi
if [[ "$(printf '%s\n' "$change" | jq -r '.result.structuredContent.verification_token | type')" != 'string' ]]; then
  printf 'Dangerous change did not return a verification token\n' >&2
  exit 1
fi

printf 'smoke: upgrade applicability\n' >&2
upgrade="$(
  curl "${curl_options[@]}" \
    --request POST \
    --header 'content-type: application/json' \
    --header 'accept: application/json, text/event-stream' \
    --header 'mcp-protocol-version: 2025-11-25' \
    --data '{
      "jsonrpc":"2.0",
      "id":4,
      "method":"tools/call",
      "params":{
        "name":"advise_network_upgrade",
        "arguments":{
          "model":"C9300-48P",
          "operating_system":"IOS XE",
          "current_version":"17.12.4",
          "target_version":"17.15.5",
          "enabled_features":[]
        }
      }
    }' \
    "$CLIDECK_MCP_BASE_URL/mcp"
)"
if [[ "$(printf '%s\n' "$upgrade" | jq -r '.result.structuredContent.status')" != 'supported_with_checks' ]]; then
  printf 'Upgrade applicability smoke test failed\n' >&2
  exit 1
fi
