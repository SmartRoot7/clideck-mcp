# CliDeck MCP

## Tagline

Verified network knowledge becomes a human-approved WebMCP change room.

## What it does

CliDeck MCP gives agents deterministic, version-aware network knowledge. Its
new Network Change Room lets a person and an agent recover a simulated Cisco
Catalyst 9300 incident together: inspect the device, retrieve active knowledge,
stage a reviewed command sequence, wait for visible human approval, execute
only in a browser simulator, and verify the result against a signed plan.

The key safety property is implemented through WebMCP lifecycle, not an agent
instruction. The execution capability is not registered at all until the
operator approves the visible change. The agent cannot approve on the human's
behalf and cannot supply a real device target.

## How WebMCP is used

The page exposes five small state-aware tools. Each tool becomes available only
when its prerequisite is visible on screen. Existing CliDeck MCP tools remain
the source of truth for snapshot redaction, knowledge retrieval, workflow
selection, deterministic risk classification, and signed verification.

WebMCP makes this experience possible because the browser agent discovers the
exact capability and schema for the current phase. It does not need to infer
controls from pixels, and dangerous capability can be absent rather than merely
disabled by prompt text.

## What was built during the challenge

CliDeck's knowledge system and public MCP existed before August 25, 2026. The
challenge work adds the `/webmcp` Network Change Room, five WebMCP tool
lifecycles, deterministic browser simulator, human-approval capability gate,
shared activity timeline, security policy, evaluation prompts, and automated
tests. The existing admin and public demo were not redesigned.

## Built with

TypeScript, React 19, Vite, WebMCP, `use-webmcp-tool`, MCP Streamable HTTP,
Hono, PostgreSQL, Codex, and GPT-5.6.

## Links

- Live app: https://mcp.clideck.com/webmcp
- Public MCP: https://mcp.clideck.com/mcp
- Repository: https://github.com/SmartRoot7/clideck-mcp
- License: Apache-2.0
- Video: pending recording and public upload
