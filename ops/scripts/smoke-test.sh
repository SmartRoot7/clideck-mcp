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
verification_handle="$(
  printf '%s\n' "$change" |
    jq -r '.result.structuredContent.verification_token'
)"
if [[ ! "$verification_handle" =~ ^vfy_[A-Za-z0-9_-]{43}$ ]]; then
  printf 'Dangerous change did not return a verification token\n' >&2
  exit 1
fi

printf 'smoke: reusable short verification handle\n' >&2
verification_request="$(
  jq -n --arg token "$verification_handle" '{
    jsonrpc:"2.0",
    id:4,
    method:"tools/call",
    params:{
      name:"verify_network_change",
      arguments:{
        verification_token:$token,
        before_snapshot:"reload state: before",
        after_snapshot:"reload state: after"
      }
    }
  }'
)"
for _verification_attempt in 1 2; do
  verification="$(
    curl "${curl_options[@]}" \
      --request POST \
      --header 'content-type: application/json' \
      --header 'accept: application/json, text/event-stream' \
      --header 'mcp-protocol-version: 2025-11-25' \
      --data "$verification_request" \
      "$CLIDECK_MCP_BASE_URL/mcp"
  )"
  if [[ "$(printf '%s\n' "$verification" |
    jq -r '.result.structuredContent.result')" != 'passed' ]]; then
    printf 'Short verification handle failed on attempt %s\n' \
      "$_verification_attempt" >&2
    exit 1
  fi
done

printf 'smoke: operational workflow and tolerant limit\n' >&2
workflow="$(
  curl "${curl_options[@]}" \
    --request POST \
    --header 'content-type: application/json' \
    --header 'accept: application/json, text/event-stream' \
    --header 'mcp-protocol-version: 2025-11-25' \
    --data '{
      "jsonrpc":"2.0",
      "id":5,
      "method":"tools/call",
      "params":{
        "name":"get_network_workflow",
        "arguments":{
          "goal":"recover a port-security err-disabled interface",
          "context":{
            "vendor":"Cisco",
            "model":"C9300",
            "operating_system":"IOS XE",
            "version":"17.15.5"
          },
          "limit":10
        }
      }
    }' \
    "$CLIDECK_MCP_BASE_URL/mcp"
)"
if [[ "$(printf '%s\n' "$workflow" |
  jq -r '.result.structuredContent.unknown')" != 'false' ]]; then
  printf 'Port-security operational workflow was not found\n' >&2
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
