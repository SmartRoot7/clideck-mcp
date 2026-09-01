# Pipeline Capacity Audit

This is the capacity policy for the eight-executor production knowledge
pipeline. Scheduling is work-conserving: priorities decide which useful task
runs first, never whether a physical executor is intentionally left idle.

## Removed nonessential restrictions

| Restriction | Why it was nonessential | Result |
| --- | --- | --- |
| Coverage eligible only after `next_check_at` | A freshness preference became a hard calendar blocker and emptied the queue. | `next_check_at` is ordering only. |
| One global Discovery/Refresh task | It serialized an eight-executor pool. | Discovery can occupy every free lane. |
| Claim-side rejection while another discovery ran | Queued parallel discovery still could not be leased. | Independent discovery tasks can run concurrently. |
| Discovery stopped at the source-buffer target | Mechanical buffering could leave every AI executor idle. | Discovery is the fallback whenever an AI lane is free. |
| Shared two-lane Review/Fidelity cap | Review backlog could coexist with six idle executors. | Review and verification can fill all free lanes. |
| One active Demand Diagnosis | Independent unanswered requests were serialized. | Each demand is deduplicated independently and diagnoses can run in parallel. |
| Demand work limited to half the pool | Queue-class fairness was implemented as a capacity ceiling. | Priority ordering provides fairness without idle lanes. |
| Legacy two-lane Analyze allocation | An inactive scheduler retained the old capacity policy. | Its allocation is work-conserving too. |
| Deploy and host-move scripts restored old capacity values | A successful migration was silently overwritten with a prior two-lane value. | Lifecycle scripts restore Pause/Resume state only; capacity remains the physical eight. |
| Admin executor-count selector | An operator could accidentally reduce the healthy production pool and recreate standby lanes. | Capacity is fixed at all eight physical executors; only explicit Pause/Resume remains. |

## Necessary controls retained

| Control | Why it is necessary |
| --- | --- |
| Eight-running-task ceiling | There are eight isolated executor processes. More leases would oversubscribe nonexistent workers; enabled capacity is fixed at all eight. |
| One live task per durable work item | Prevents duplicate publication, duplicate demand work, and two executors mutating the same target. It does not prevent different targets from running together. |
| Transactional leases, heartbeats, and row locks | Prevent concurrent ownership and recover work after a crashed executor. |
| Explicit operator pause and scoped circuit isolation | Protect production during a confirmed system/model failure. A healthy work class continues running and discovery remains the fallback. |
| Bounded evidence batches and model context | Prevent truncation and invalid model artifacts; more batches may run concurrently. |
| Retry attempt accounting and failure classification | Prevent one broken task from retrying forever; other useful targets continue filling the pool. |
| Official-source, provenance, immutable-revision, risk, conflict, and publication checks | Protect the correctness and safety of the knowledge product. They do not cap executor concurrency. |
| Public API rate limits and request-size limits | Protect the public service from abuse and are outside pipeline executor scheduling. |

## Nonblocking scheduling inputs retained

- Stage weights and task priority select the next task but impose no lane cap.
- `next_check_at` and `updated_at` rotate coverage refreshes from oldest to
  newest; they do not determine eligibility.
- Source-buffer and prepared-source targets guide mechanical preparation; they
  do not stop background discovery from filling an otherwise idle AI lane.
- Publication batching remains deterministic mechanical work. It cannot block
  AI capacity because discovery is always available as the fallback.
