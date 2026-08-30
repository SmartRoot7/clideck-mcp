# CliDeck Network Change Room — PRD

## User outcome

A network operator and browser agent recover a simulated Cisco Catalyst 9300
port-security incident together. CliDeck supplies version-aware guidance,
deterministic change review, a mandatory human approval gate, sandbox-only
execution, and signed post-change verification.

## Requirements

- The experience is public at `/webmcp` and does not change `/admin` or `/demo`.
- The scenario is deterministic and never connects to a real device.
- Five focused WebMCP tools expose inspect, guidance, staging, execution, and
  verification capabilities.
- The execution tool is not registered until a human explicitly approves the
  staged change in the visible page.
- Unsupported or reordered commands fail atomically before simulator state is
  changed.
- Existing public MCP tools remain the source of truth for knowledge, review,
  redaction, and verification.
- The page works normally without WebMCP and explains how to enable support.

## Success criteria

The complete incident can be demonstrated in under three minutes, every agent
action is visible in the timeline, verification passes, and automated tests
prove that approval cannot be delegated to the agent.
