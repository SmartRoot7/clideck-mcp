# CliDeck Network Change Room — Technical spec

## Architecture

The existing React/Vite admin bundle serves a separate public `/webmcp` route.
It owns an in-memory deterministic lab reducer and calls the existing same-origin
`/mcp` endpoint with stateless JSON-RPC. No database schema or public MCP
contract changes are required.

## State and tools

The lab advances through `ready`, `inspected`, `guided`, `staged`, `approved`,
`executed`, and `verified`. Reset returns the initial err-disabled state.

WebMCP tools are lifecycle-bound to the page:

1. `inspect_lab_device` sends the simulated snapshot through
   `analyze_device_snapshot` with strict redaction.
2. `find_network_guidance` calls `query_network_knowledge` and
   `get_network_workflow` for a C9300 running IOS-XE 17.12.4.
3. `stage_network_change` validates a fixed safe recovery sequence before
   calling `review_network_change`.
4. `run_lab_commands` is registered only in the manually approved state and
   applies the exact staged sequence atomically to the simulator.
5. `verify_lab_change` calls `verify_network_change` with captured before/after
   snapshots and the short verification handle.

All browser tool responses are concise structured text. Snapshot-derived output
is marked untrusted. Read-only tools are annotated. The API sends
`Permissions-Policy: tools=(self)`.

## Security and compatibility

There is no arbitrary command execution, network-device address, credential,
SSH client, or persistent lab state. Manual approval exists only as a visible
button. The existing app shell, admin authentication, demo routes, public MCP
schemas, and production deployment workflow remain unchanged.
