# Demo script — target 2:30

## 0:00–0:15 — The problem

Show the live Network Change Room. Explain: a C9300 access port is
err-disabled after a port-security violation. The page exposes structured
WebMCP capabilities instead of asking an agent to scrape the interface.

## 0:15–0:45 — Inspect

Ask the agent to inspect the incident. Show the detected C9300-48P and IOS-XE
17.12.4 context, strict redaction, `retention: not_stored`, and the visible
activity entry.

## 0:45–1:15 — Ground in real CliDeck knowledge

Ask for recovery guidance. Show that the browser tool calls the existing
public CliDeck MCP, returns active immutable revision references, and proposes
the exact bounded recovery sequence.

## 1:15–1:45 — Stage and prove the human gate

Ask the agent to stage the sequence. Show deterministic high-risk review,
pre-checks, rollback, and the visible approval panel. Point out that
`run_lab_commands` is absent from the agent tool surface. Attempting to execute
now cannot work because the capability does not exist.

## 1:45–2:05 — Human approval and sandbox execution

Click **Reviewed — approve in sandbox**. Show `run_lab_commands` appearing.
Ask the agent to run the exact batch and emphasize the returned target:
`deterministic_browser_simulator`, never a real device.

## 2:05–2:30 — Signed verification

Ask the agent to verify. Show Gi1/0/24 up/up, all required checks passing, and
the complete human-and-agent timeline. Close with: WebMCP is not merely a
shortcut here; tool availability itself is the safety boundary.
