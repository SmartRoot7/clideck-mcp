# CliDeck Network Evidence Workbench — Technical spec

## Architecture

The existing React/Vite bundle serves `/webmcp`. Raw files and complete
extracted text remain in browser memory. A selected, locally redacted evidence
window is sent to the existing same-origin `/mcp` JSON-RPC endpoint. The
serialized envelope is measured in UTF-8 and must remain below 60,000 bytes.

`pdfjs-dist` is pinned and loaded only when a PDF is selected; its worker is a
same-origin Vite asset. Up to five files, 10 MiB each, 25 MiB total, and 500 PDF
pages are accepted. Encrypted and image-only PDFs return
`PDF_TEXT_UNAVAILABLE`; OCR is explicitly out of scope.

## Versioned case lifecycle

`case_version` increases whenever the question, evidence, selected window, or
context changes. Analyze, search, presentation, and research calls include an
expected version. Reset, unmount, or a newer version aborts parsing, fetches,
and polling. A late result returns `CASE_VERSION_CONFLICT` and is discarded.

Manual context values win. Snapshot analysis fills only empty vendor, model,
OS, and version fields. Search is enabled when at least vendor, model, or OS is
known; version remains optional.

## WebMCP tools

1. `read_network_case` returns a redacted evidence window of at most 8,000
   characters only after the sharing gate.
2. `analyze_network_case` calls `analyze_device_snapshot` and fills empty
   context fields.
3. `search_network_case` calls real knowledge/workflow tools and returns a
   compact result while the page displays the full answer.
4. `present_network_case_analysis` accepts a bounded agent interpretation and
   only current result revision references.
5. `start_case_research` creates one idempotent expert task only after unknown.
6. `get_case_research_status` uses in-memory task credentials and exposes the
   documented lifecycle without leaking the access token.

All six tools are always registered. Evidence and agent-authored text are
marked untrusted; read operations are marked read-only. The page uses a small
local React lifecycle wrapper so WebMCP's `AbortSignal` reaches `/mcp`.

## Backend additions and privacy

`get_knowledge_provenance` accepts up to five active public revision refs and
returns only source kind/ref, title, public HTTPS URL or first-party locator,
document version/date, and verification date.

For `analyze_device_snapshot`, `mcp_request_logs` stores only the SHA-256 label
of redacted input, byte count, snapshot types, redaction counts, outcome,
duration, and error code. Evidence, filenames, previews, and response fragments
are never journaled. Expert-task idempotency is checked under an advisory lock
before the daily rate-limit charge.
