# CliDeck Knowledge Pipeline 2.0

## Product rule

CliDeck is a source-faithful technical reference, not an execution policy
engine. A documented command, option, operational fact, diagnostic observation
or procedure is eligible for publication. Risk, confidence, quality, rollback,
vendor, operating system, model and version remain useful metadata and ranking
signals; none is a publication gate. Retrieval ranks exact context first and
then widens progressively instead of returning an empty answer.

Document navigation, copyright, part inventories, physical installation,
general safety boilerplate and marketing can be classified as
`non_knowledge`. Technical logs, sample configurations, troubleshooting,
commands and multi-command examples are always potential knowledge.

## Reliability rule: useful work must keep moving

CliDeck is fail-open for optional quality and telemetry signals. A valid,
processable result must continue to the next stage even when an optional
runtime event, confidence hint, exact context field, QA response or other
observability signal is missing. Such absence is recorded and shown to the
operator; it does not become a rejection, retry loop, global circuit or
publication stop.

A hard stop is allowed only when the next operation is technically impossible
or would corrupt state: invalid structure that cannot be parsed, unavailable
required bytes, failed persistence, broken provenance identity or loss of the
task lease. New blocking conditions require evidence that continuing cannot
work, a narrowly scoped failure, and a regression test. Telemetry must never be
used as proof that the underlying work did not happen.

When uncertain, preserve the result, continue processing and let downstream
Acquire, conversion, schema validation, deduplication and asynchronous QA
provide evidence. The product must prefer degraded but useful operation over a
fully idle pipeline.

## Versioned source processing

Sources have stable `source_kind`, `source_ref` and `display_locator` identity.
The supported kinds are `official_web`, `admin_web`, `admin_document`,
`pasted_text` and `field_log`. Every distinct content hash is an immutable
artifact; it is never overwritten by a later fetch.

Each processing version creates a `source_processing_runs` record binding the
artifact to converter, segmenter, extractor, prompt and model versions.
Fragments and candidates link to this run. Exact candidate duplicates create a
run occurrence rather than disappearing from completeness statistics.

The source-oriented flow is:

1. Discover or authenticated Intake.
2. Acquire an immutable artifact.
3. Convert all content; PDF OCR advances in resumable page ranges without a
   document-wide 100-page ceiling.
4. Segment with structural page/heading context and controlled overlap.
5. Extract commands, options, facts, workflows and diagnostics.
6. Publish confirmed source-backed units incrementally.
7. Audit fidelity asynchronously against a shared source window.
8. Repair only a concrete failed unit with Deep Low; use Deep Medium only when
   the Low repair remains ambiguous.
9. Normalize optional context, deduplicate and retain every provenance
   occurrence.

Every fragment ends as `knowledge_extracted`, `non_knowledge`,
`continuation_required` or `targeted_retry`. A processing run is incomplete
while a continuation or retry is open.

## Fidelity and repair

Fidelity QA checks omissions, unsupported additions, syntax damage, incorrect
option descriptions, broken boundaries, duplicates and lost workflows. It is
observability and targeted repair, not a gate in front of all publication.
A QA outage records `unavailable` and does not alter knowledge state.

New converter/extractor/prompt/model profiles are checked at 100%. After 1,000
checks and a material-error rate below 1%, deterministic sampling falls to 10%.
A material error restores 100% coverage for the next 20 batches. QA, repair and
exclusion results are recorded in `pipeline_quality_checks`.

Fidelity and Deep Repair share at most two executor lanes. Deep Low receives at
most eight records sharing a run, error class and evidence window. Deep Medium
receives at most four unresolved Low records. Partial valid output is retained;
omitted indices return in smaller batches.

## Intake, crawl and logs

The local `super_admin` Intake page accepts an HTTPS documentation root, pasted
text, supported documents and field logs. Uploads stream outside the JSON body
limit into protected staging. Files are MIME-sniffed, hashed and atomically
promoted. Field-log secrets and stable identifiers are replaced before the
immutable artifact is stored; raw staging is deleted immediately.

Website jobs use a durable page frontier, prefer sitemap data and then traverse
breadth-first inside the original host/path prefix. DNS/SSRF and scope checks
apply to every fetch and redirect. No URL keyword filter decides whether a page
contains knowledge.

## Reprocess and releases

One global reprocess job may run at a time. Retained artifacts are processed
under a new version; purged web sources are downloaded again and purged local
sources are reported unavailable without changing active knowledge. Exact
duplicates are occurrences/no-ops, matching items receive revisions, new facts
receive new items and unmatched legacy knowledge is reported rather than
deleted.

Delta releases support both `upsert` and `deactivate`. A processing-run rollback
is a new compensating release on top of the current head. It restores each
previous revision or deactivates a net-new item. If the same item changed after
the target run, the preview reports a conflict and apply refuses to overwrite
it. Unrelated later items are untouched.

## Capacity and compatibility

The local pool contains `pipeline-executor-01` through `08`; configured global
concurrency is 1–8. Discovery is serialized, at least one lane is preserved for
Extract when it has backlog, and Fidelity plus all repair work share the fixed
two-lane cap. Idle restricted stages do not reserve unused capacity.

Existing public MCP contracts, `/admin`, `/demo` and `/webmcp` remain backward
compatible. First-party source locators expose safe metadata only and never the
uploaded content.
