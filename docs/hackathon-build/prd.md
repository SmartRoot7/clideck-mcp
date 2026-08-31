# CliDeck Network Evidence Workbench — PRD

## User outcome

A network engineer pastes or selects real device output, configuration, or a
manual and asks a practical question. CliDeck redacts secrets in the browser,
detects the device context, searches active production knowledge, and shows an
answer with safe source metadata. A WebMCP-capable browser agent can inspect
the same current case without copying evidence into chat.

The workbench never connects to equipment and never executes commands. It is a
useful manual product when WebMCP is unavailable, not a simulator or a tool
catalogue.

## Requirements

- Public `/webmcp` page with question, evidence, editable context, official
  results, separate agent analysis, and tracked research status.
- TXT, LOG, MD, CSV, JSON, JSONL, HTML, and text-layer PDF input with explicit
  file/page/byte limits and visible evidence-window selection.
- Secret-only local redaction before all requests. Operational IP, MAC,
  hostname, and username values remain visible and this is disclosed.
- Six stable WebMCP tools operating on a monotonically versioned case. Stale
  asynchronous results cannot update a changed case.
- Evidence is withheld from the browser agent until one explicit sharing
  toggle is enabled. Filenames are never exposed to the agent.
- Real same-origin public MCP calls for snapshot analysis, knowledge,
  workflows, provenance, expert research, and task status.
- Tracked research can start only after a real unknown result; repeated starts
  reuse the same task without spending the daily quota twice.
- Existing `/admin`, `/demo`, public contracts, knowledge thresholds, and
  deployment workflow remain compatible.

## Success criteria

A judge can use both official Cisco samples and their own safe text/PDF,
observe the case-version change, obtain different version-aware results with
active provenance, and ask the browser agent to explain only the current
result set. The same flow remains fully usable through buttons in a normal
browser.
