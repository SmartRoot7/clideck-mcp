# Researcher automation

The macOS launchd pool supervises `pipeline-executor-01` through `08`.
Each leases one useful task atomically through the restricted researcher bridge;
standby polling starts no Codex run. PostgreSQL owns task/lease state.
See [capacity policy](PIPELINE_CAPACITY_AUDIT.md) and read the
[corrective log](PIPELINE_CORRECTIVE_ACTION_LOG.md) before changes or monitoring.

Recurring checks must measure learning against the original unanswered questions,
not just executor activity or database growth. Use the compact read-only
`ops/sql/learning-health.sql` alongside service/lease health. It reports old and
repeated questions, completed replays, discovery without new evidence and ready
sources with no work. A short sample is not an extended soak. User demands take
priority over background coverage; private project behavior requires private
evidence, not a public manual or a fabricated answer.

## Runtime policy

`src/cli/pipeline-codex-policy.ts` and `src/domain/pipeline.ts` enforce:

- `/admin/models` controls 1–8 enabled lanes and independent model/effort pairs
  for Luna (ordinary work) and Luna High (demand diagnosis/advanced review).
  Defaults remain 5.6 Luna low/medium, with explicit Terra medium fallback for High.
- Claims snapshot profile, model, effort and settings version; existing runs
  retain that snapshot. Reducing capacity drains runs; Pause stops them.
- One pool publishes the installed, authenticated Codex `model/list` catalog.
  Model changes require a fresh catalog and structured-output/web capability;
  count-only changes work during catalog outages. No automatic model substitution.
- Circuits isolate profile/task/model/effort. An unavailable model requires
  operator replacement or **Retry model once**; explicit fallback is audited.
- Web research: only expert research, source discovery and refresh. These enable
  `code_mode`, `code_mode_host` and `standalone_web_search` together.
- Other tasks have no web access. All runs are ephemeral, bounded, read-only,
  without inherited MCP servers, plugins, shell tools or application secrets.

Acquire, conversion/OCR, chunking, hashing, indexing and publication are worker
operations. Scheduling prioritizes useful work without reserving idle capacity;
publication activation is serialized transactionally.

## Local setup

Ignored `.secrets/researcher-bridge.env`:

```text
CLIDECK_RESEARCHER_URL=http://127.0.0.1:28788/mcp
CLIDECK_RESEARCHER_TOKEN=<researcher bearer token>
CLIDECK_PIPELINE_CODEX_BINARY=/absolute/path/to/codex
CLIDECK_RESEARCHER_SSH_HOST=100.116.82.78
CLIDECK_RESEARCHER_SSH_USER=<restricted SSH user>
CLIDECK_RESEARCHER_SSH_IDENTITY=/absolute/path/to/private-key
CLIDECK_RESEARCHER_TUNNEL_PORT=28788
```

After the matching backend migration is healthy:

```bash
pnpm pipeline:install-launchd
pnpm pipeline:pool-status
launchctl print "gui/$(id -u)/com.clideck.mcp.pipeline-tunnel"
```

Deployment and installation reject other Node major versions. Put Node 24 on
`PATH`; the installer pins that executable. Model/effort environment overrides
are obsolete. The tunnel is independent of the pool. Lease files live in
`.secrets/pipeline/<executor-id>/`; schemas/artifacts/usage in
`tmp/pipeline/<executor-id>/`. Never include credentials, lease tokens or another
executor's files in model prompts. Normal deployments manage pool reloads.

## Pause and recovery

Super-admin **Pause all agents** calls `POST /admin/v1/pipeline/state` with
`{"enabled":false,"reason":"manual pause"}`; resume uses `{"enabled":true}`.
Runs poll control at most every five seconds and terminate within ten seconds,
discard partial output and return reservations. A running mechanical step may
finish; no new work is claimed while paused.

If backend controls are unavailable, use `pnpm pipeline:pool-stop` or
`pnpm pipeline:pool-start`; the tunnel remains available and abandoned leases
expire normally. All enabled lanes remain available to every useful stage.

The Models page caches official Standard Codex credits per million input,
cached input and output tokens, with source/date/error. Refresh is fixed to the
official pricing URL; outages retain the last successful rates. These are not
API dollar prices or included subscription limits. Seven-day observations show
failures, duration and extraction Fidelity findings without inventing a quality ranking.


### Original-question technical learning

The `technical-operations` Domain Kit pack covers macOS/Linux, Node/Python,
developer tools and APIs without inventing network vendor/OS identities.
Requested OS/component versions remain separate; published context describes only
source-supported applicability. Unknown/partial public queries create durable
user demands. Legacy macOS/software queries route conservatively to this domain;
explicit network hardware/protocol questions retain network applicability.

After diagnosis, `technical_answer` (Luna) and independent
`technical_answer_review` (Luna High) take priority 165, above bulk demand
extraction/discovery (160), below diagnosis (170). They may fill all operator
lanes; ordinary leases, retries, profiles and Pause apply. Synthesis reads at most
16 official-source spans / 64 KiB without taking source reservations. Each window
advances unseen evidence and retains cited evidence from the prior proposal.
Consumed evidence windows are not retried as new tasks. Missing public evidence
feeds focused discovery; missing private logs/code/versions are stated explicitly.
Repeated queries cannot silently clear that requirement or rejected-answer feedback.

A reviewed supported answer uses `technical_answer_publication`, ordinary core
immutable revisions and normal release activation. Only a complete independent
review of every diagnosis capability AND exact original-question/context replay
against an active revision closes the demand. Related search hits and partial
publications remain partial. Private questions/context/hashes live in the learning
ledger; public records contain generalised source-backed knowledge. Versioned
component-aware feedback uses `report_domain_knowledge_gap`; existing network
feedback remains compatible. `get_learning_status` explains missing private data.
The two-hour check uses `ops/sql/learning-health.sql` to measure closure and
progress rather than database growth. A short baseline is not an extended soak.
