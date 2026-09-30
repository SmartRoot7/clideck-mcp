# Published metrics contract

Reference for the separate website `/admin/mcp` Overview, only when website work
is requested. Validate its actual implementation before applying this handoff.
Backend/shared contracts live in `src/domain/admin.ts` and
`packages/admin-contracts/src/index.ts`.

| Field | Meaning |
| --- | --- |
| `published_records_24h` | Candidates that became `published` in the 24 hourly buckets ending in the current hour |
| `published_hourly_24h` | Exactly 24 chronological `{ hour: ISO timestamp, published: integer }` rows, including zeros |
| `pipeline_funnel` | One row per returned stage: `{ stage, count, queued, running, completed, failed, cancelled, skipped }` |
| `activity_30d[].published` | Daily published records; `revisions_created` is diagnostic only |

Publication means output accepted into a knowledge release, not candidates,
fragments or completed task counts. Avoid a fixed stage count: follow the current
contract and render each stage once.

UI: `Published / 24h` total, full-width 24-hour bar chart and published 30-day
series. Show timezone, zero hours, integer y-axis, focus/tap values and accessible
data; retain last good data with stale/update-time indicators on error. Keep
mobile chronological and free of page overflow. A small SVG chart is sufficient.

BFF allowlist must retain `published_records_24h`, `published_hourly_24h`,
`cancelled`, nested `hour`/`published` and known statuses while rejecting unknown
keys/provenance. Preserve fixed routes, HMAC/RBAC, `no-store`, size and logging
limits. Verify filtering, zero/24-point ordering, unique stages and responsive
rendering with focused tests before a separately authorized site release.
