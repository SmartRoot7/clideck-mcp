# Architecture

Deterministic reads, asynchronous evidence processing, immutable publication.
PostgreSQL 16 is the state store, queue, search engine and release coordinator;
Redis, vector databases and external model APIs are not required.

## Boundaries

| Component | Responsibility |
| --- | --- |
| API | Public MCP, health/readiness/metrics, optional authenticated remote admin and website BFF facade |
| Worker | Acquire, convert/OCR, chunk, reconcile, publish, expire retained data |
| Researcher | Loopback-only authenticated task/lease/artifact bridge |
| macOS pool | Eight isolated ephemeral Codex executors; no DB credentials; bounded leased payloads |
| Local admin | Authenticated operations console, loopback port 8790 behind Caddy/Tailscale |
| Browser | Shared `/admin` and `/demo` bundle; separate `/webmcp` evidence workspace |

Researcher/model output is untrusted until validated. The core owns revisions,
provenance, release activation, risk/conflict handling and audit. Packs registered
from local code define subject schemas, normalization, validation and mappers.
Providers add storage/spatial/relations/labs through Domain Kit interfaces.

## Knowledge and retrieval

- `knowledge_items`: stable identities; `knowledge_revisions`: append-only facts.
- `release_changes`: immutable deltas; `release_items`: snapshots/checkpoints.
- `active_knowledge_state`: current revision per item; `active_release`: head.
- `domain_id`, `domain_schema_version`, `domain_context`, `domain_payload` isolate
  subjects. Network views explicitly select `network`.
- Search uses context/version applicability, PostgreSQL FTS, `pg_trgm`, quality,
  freshness and conflicts. It does not call a model or use vector ranking.
- Portable software applicability is separate from hardware vendor identity.
  Exact/model overlays precede broader references; fallback scope and version
  relation must be labelled. Unknown context must not become invented context.
- Compound answers report complete/partial/unknown capability coverage. Durable
  demands close only when deterministic replay finds the required active answer.
- Public records use explicit projections; safe source metadata has its own
  active-revision-only endpoint. See [Security](SECURITY.md).

## Pipeline and releases

[Pipeline 2.0](KNOWLEDGE_PIPELINE_2.md) owns the processing contract; read the
[corrective log](PIPELINE_CORRECTIVE_ACTION_LOG.md) before changing it.
Work flows through discover/intake → acquire → convert → chunk → extract →
incremental publication, with asynchronous Fidelity QA and targeted repair.

Publication serializes activation under a transaction advisory lock. Ordinary
pipeline batches contain up to 50 ready records; a full checkpoint is stored
every 120 releases. Arbitrary release rollback reconstructs from the nearest
checkpoint plus deltas atomically. Processing-run rollback creates a compensating
release and refuses to overwrite later changes to the same item. Revisions are
never rewritten. Legacy imports are resumable by manifest hash and legacy key;
historical import totals are not ongoing database-size constraints.

Current Pipeline 2.0 code treats confidence/quality/rollback as descriptive
metadata, while schema, evidence identity, risk classification, conflict and
release controls remain enforced. The old blanket 0.90/0.95 confidence-gate
claims are obsolete; this is a description of existing code, not permission to
weaken the [agent safeguards](../AGENTS.md). Policy implementation lives in
`packages/domain-kit/src/core.ts`, `domains/network/src/pack.ts` and
`src/domain/publication.ts`.

## Product surfaces

- Snapshot analysis is in-memory; explicit opt-in contributions use a separate
  quarantine role and 30-day TTL, never automatic publication.
- Change review classifies risk deterministically. Verification uses expiring
  credentials; missing output must never produce a false `passed` result.
- Expert tasks use leases, heartbeats and bounded attempts. Tenant tasks remain
  isolated; anonymous tasks use random IDs and separately hashed access tokens.
  Public milestones omit questions, private source data and internal failures.
- `/demo` uses the same `OperationsApp` and real read models as `/admin`, with
  server-side redaction and GET/HEAD-only routes. Local demo acknowledgements
  issue no mutations. `ENABLE_PUBLIC_DEMO=false` removes the demo routes.
- [WebMCP](WEBMCP.md) uses bounded same-origin MCP requests and a monotonic case
  version; it never grants hidden file access or device execution.
- The separate website uses named BFF operations, never a generic proxy.

## Lab assurance

Batfish models bounded configuration/reachability checks. Containerlab uses
available runtime images. `batfish_modeled` cannot imply `runtime_lab_validated`;
the latter requires an actual runtime test. Import only a passing hashed lab
report bound to the deployed Git commit.
