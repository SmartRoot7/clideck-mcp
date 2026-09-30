# Knowledge Pipeline 2.0

Read [corrective log](PIPELINE_CORRECTIVE_ACTION_LOG.md) before pipeline work.
[Agent safeguards](../AGENTS.md) and [capacity policy](PIPELINE_CAPACITY_AUDIT.md)
remain mandatory. Current implementation: `src/domain/pipeline.ts`,
`pipeline-worker.ts`, `pipeline-v2.ts`, `intake.ts`, `publication.ts`.

## Processing contract

CliDeck is a source-faithful technical reference. Source-backed commands,
options, facts, diagnostics and procedures are eligible knowledge. Navigation,
copyright, inventories, installation boilerplate and marketing may be
`non_knowledge`; technical logs/configurations/examples remain potential evidence.
Do not fabricate exact vendor/model/version context or suppress a documented
command merely because it is risky.

Optional telemetry/QA failure must not discard an otherwise processable result.
Record degradation and continue useful work. Invalid structure, missing required
bytes, persistence failure, broken provenance or lost lease require a scoped
failure. Preserve schema, risk/conflict, source-binding and release controls;
new blocking conditions need evidence and regression coverage.

Pipeline 2.0 stores confidence, quality and rollback as metadata, not the old
blanket 0.90/0.95 publication gate. See the implementation/policy distinction in
[Architecture](ARCHITECTURE.md); do not change policy as a documentation cleanup.

## Identity and lifecycle

- Sources: stable `source_kind`, `source_ref`, `display_locator`; kinds are
  `official_web`, `admin_web`, `admin_document`, `pasted_text`, `field_log`.
- Content hashes identify immutable artifacts. Processing runs bind an artifact
  to converter, segmenter, extractor, prompt and model versions. Fragments and
  candidates belong to an exact run; duplicates retain run occurrences.
- Flow: discover/authenticated intake → acquire → convert → segment → extract →
  incremental publish → asynchronous Fidelity QA → targeted repair.
- Conversion processes all content; worker PDF OCR resumes by page range.
  Segmentation preserves page/heading context and bounded overlap.
- Fragment dispositions: `knowledge_extracted`, `non_knowledge`,
  `continuation_required`, `targeted_retry`. Open continuation/retry means the
  run is incomplete. Terminal reconciliation must preserve fresh leased work.

## Fidelity and repair

QA checks omissions, unsupported additions, syntax/options, boundaries,
duplicates and lost workflows against the shared source window. QA outage is
`unavailable`, not a global publication stop. Checks are recorded in
`pipeline_quality_checks`.

New profiles receive 100% checks; after 1,000 checks with material error below
1%, sampling is 10%. A material error restores full coverage for 20 batches.
Deep Low repairs at most eight related records per bounded evidence batch;
Deep Medium handles at most four unresolved Low records. Preserve partial valid
output and retry omitted indices in smaller batches. These are context bounds,
not executor caps: every stage may use every enabled free lane (admin-selected 1–8).

## Intake and crawl

Local `super_admin` intake accepts HTTPS roots, supported documents, pasted text
and field logs. Uploads stream into protected staging outside the JSON limit;
MIME checks, hashes and atomic promotion precede processing. Field-log secrets
and stable identifiers are replaced before storage, and raw staging is deleted.

Website jobs use a durable frontier, prefer sitemaps, then traverse inside the
original host/path scope. HTTPS/DNS/SSRF checks apply on every fetch/redirect.
A URL keyword is not proof that a page contains or lacks knowledge.

## Reprocess and rollback

Only one global reprocess job runs at a time (state integrity, not a lane cap).
Retained artifacts receive new processing versions; purged web sources are
refetched, unavailable local artifacts are reported without changing knowledge.
Duplicates become occurrences, changed facts become revisions, new facts become
items; unmatched legacy knowledge is reported, not deleted.

Delta releases support `upsert` and `deactivate`. Processing-run rollback appends
a compensating release, restores prior revisions/deactivates net-new items,
refuses conflicts with later changes to the same item and preserves unrelated
later work. Public MCP, `/admin`, `/demo` and `/webmcp` remain compatible.
