# Network Evidence Workbench

Public `/webmcp` is a React/Vite case workspace for engineers and browser agents.
It never connects to devices or executes commands; ordinary controls work without
WebMCP. Implementation: `apps/admin/src/webmcp/` and `src/domain/provenance.ts`.

## Evidence and lifecycle

- TXT/LOG/MD/CSV/JSON/JSONL/HTML and text-layer PDF; max five files, 10 MiB each,
  25 MiB combined, 500 PDF pages. Lazy same-origin PDF worker; no OCR/encrypted/
  image-only PDF support (`PDF_TEXT_UNAVAILABLE`). Worker-side OCR is separate.
- Complete files/extracted text remain in browser memory. Only the selected
  line/page window, redacted locally, enters same-origin `/mcp`. Serialized UTF-8
  JSON-RPC envelope stays below 60,000 bytes.
- Secrets/serial-like values are redacted. Diagnostic IP/MAC/hostname/username
  values remain, with disclosure. Browser-agent evidence access needs the
  explicit sharing toggle; filenames and task access tokens are never exposed.
- `case_version` increases on question/evidence/window/context changes.
  Async calls include expected version; reset, unmount and newer cases abort
  parse/fetch/poll. Late results return `CASE_VERSION_CONFLICT` and are discarded.
- Manual context wins; analysis fills empty fields. Search needs vendor, model
  or OS, with version optional. Automatic version formatting is normalized.

## Six stable browser tools

| Tool | Contract |
| --- | --- |
| `read_network_case` | Gated redacted evidence window, max 8,000 characters, pagination; no filename |
| `analyze_network_case` | Real snapshot analysis fills empty context fields |
| `search_network_case` | Knowledge/workflows; compact agent response, full page result |
| `present_network_case_analysis` | Separate bounded agent interpretation citing only current revision refs |
| `start_case_research` | One idempotent expert task after a real unknown; reuse precedes quota charge |
| `get_case_research_status` | Real lifecycle using in-memory credentials; no access token in result |

Tools stay registered; untrusted evidence/agent text remain data. WebMCP's
`AbortSignal` reaches the network request. Official results retain actual scope:
prefer matching vendor/context, label widened/reference guidance and do not
misrepresent nearby versions as exact matches.

`get_knowledge_provenance` is a backend MCP tool: at most five active revision
refs, returning safe source kind/ref/title/URL and document/verification dates.
Uploads get first-party metadata locators. No evidence bytes/hashes are exposed.
Snapshot journaling stores only redacted-input metadata, never evidence/previews.

## Acceptance

1. Load Cisco 16.10 sample, analyze, search: context is retained and broader EFSU
   guidance is labelled as reference, with active source metadata.
2. Read before sharing: `EVIDENCE_ACCESS_NOT_GRANTED`. Enable sharing: only the
   current redacted window is returned; explain it in the separate agent block.
3. Replace with 17.8.1 during pending work: new version/context, old result
   rejected. Current applicable guidance must carry its actual version relation.
4. Fabricated/stale citation: `ANALYSIS_CITATION_NOT_IN_CURRENT_RESULTS`.
5. Safe PDF/LOG window, manual context, limits, cancellation and no-WebMCP manual
   fallback all work; reset clears file references, results and polling.
6. Real unknown → tracked research; repeated start reuses task/quota. No immediate
   publication promise. Privacy canaries remain absent after redaction and from
   persisted snapshot journal rows.

Use live results when demonstrating these flows; dataset changes can change the
particular returned revision. Historical demo/submission assets are in
[the submission record](../devpost-submission.md).
