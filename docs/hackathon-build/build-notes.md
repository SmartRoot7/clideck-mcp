# Hackathon build notes

- 2026-08-30: Devpost registration was confirmed. Existing immutable knowledge,
  public MCP, research pipeline, admin, demo, and deployment workflow predate
  the challenge.
- 2026-08-30: The first challenge implementation used a deterministic lab and
  approval-gated execution. User review correctly found it artificial and not
  useful outside the demo.
- 2026-08-31: The lab was replaced with Network Evidence Workbench: a real
  question/evidence/context/results workspace that remains useful without
  WebMCP and never claims access to customer equipment.
- 2026-08-31: Full files remain local. Only an explicit evidence window is
  redacted and sent to CliDeck. Browser-agent access has one visible opt-in;
  filenames and task access tokens are not exposed.
- 2026-08-31: Case versions plus cancellation prevent parse, MCP, presentation,
  or polling results from leaking into a changed case.
- 2026-08-31: Added safe active-revision provenance, metadata-only snapshot
  observability, and pre-quota expert-task idempotency.
- 2026-08-31: `pdfjs-dist` is pinned, lazy-loaded, and served with a same-origin
  worker. OCR, encrypted PDFs, image-only PDFs, device connections, and command
  execution are deliberately not claimed.
- 2026-08-31: Independent code/privacy review found five material boundary
  defects before release: missing production grants for provenance, incomplete
  structured-secret redaction, a full sanitized-snapshot echo to the browser
  agent, missing unmount cancellation, and an over-wide combined result set.
  All were corrected before deployment. Acceptance tests now cover JSON/YAML/
  env/JWT secrets, file and page limits, PDF cancellation, execution-signal and
  unmount cancellation, stale research status, and task-token non-disclosure.
- 2026-08-31: Production walkthrough found a cross-vendor result caused by a
  coincident version number. The workbench now prefers the detected vendor when
  that vendor has results, falls back broadly only when it has none, and marks
  out-of-range guidance as nearest rather than version-matched.
- 2026-08-31: The same walkthrough exposed an IOS XE display-format mismatch:
  `17.08.01` was treated as older than `17.3.2a`. Automatically detected numeric
  version segments are now canonicalized (`17.8.1`) before retrieval; manual
  context remains untouched.
- GitHub push and Devpost submission remain outside the authorized release.
