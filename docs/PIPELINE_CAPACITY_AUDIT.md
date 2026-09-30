# Pipeline capacity policy

Enabled production fills every operator-selected lane (1–8) whenever useful work
exists. Priorities choose order; they never reserve idle capacity. The September
2026 user request authorizes capacity selection; Pause remains separate.
See [agent rules](../AGENTS.md) and [runtime](RESEARCHER_AUTOMATION.md).

## Removed restrictions — do not restore

- Future `next_check_at` as eligibility: use it for ordering; when all targets
  are future-dated, rotate least recently searched first.
- Global single Discovery/Refresh task or claim; source-buffer suppression.
- Shared two-lane Review/Fidelity cap, one Demand Diagnosis, half-pool demand
  allocation or legacy two-lane Analyze ceiling.
- Lifecycle scripts overriding the operator's selected capacity.

Discovery/refresh fills every lane left free by higher-priority independent
work. Weights, source/prepared buffers and publication batching must not block
useful AI work.

## Retained integrity controls

| Control | Purpose |
| --- | --- |
| Selected 1–8 running tasks | Atomic shared reservation; lowering drains existing runs |
| One live task per durable item | Prevent duplicate ownership/publication without serializing independent items |
| Transactional leases, row locks, heartbeats | Ownership and crash recovery |
| Explicit pause, scoped circuits | Isolate real incidents while healthy task classes continue |
| Bounded context/batches, finite retry accounting | Prevent truncation and infinite broken-task loops |
| Source policy, provenance, immutable revisions, publication/risk/conflict checks, audit | Knowledge integrity |
| Public API rate/body limits | Abuse protection, independent of pipeline throughput |

No throughput cooldown, daily quota, cost throttle or artificial queue blocker
may be added without explicit user approval. Evidence and deployment history:
[corrective log](PIPELINE_CORRECTIVE_ACTION_LOG.md).
