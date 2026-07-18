# CliDeck MCP admin published metrics handoff

Work only in the main CliDeck website repository. Do not change
`clideck-mcp`.

Update the existing independent `/admin/mcp` Overview. The backend overview
contract now exposes:

- `published_records_24h`: the sum of knowledge candidates whose final status
  became `published` in the 24 hourly buckets ending with the current hour;
- `published_hourly_24h`: exactly 24 ordered rows shaped as
  `{ hour: ISO timestamp, published: integer }`, including zero-value hours;
- `pipeline_funnel`: exactly one row per stage for work touched in the last
  24 hours, shaped as
  `{ stage, count, queued, running, completed, failed, cancelled, skipped }`;
- `activity_30d[].published`: daily published-record totals. Keep
  `revisions_created` only as a secondary diagnostic.

The metric is intentionally about accepted output, not candidate creation,
fragment processing, or task completion. A record appears only after
verification and atomic knowledge-release publication changed its candidate
status to `published`.

## Required UI changes

1. Replace the Overview throughput card with:
   - label: `Published / 24h`;
   - value: `published_records_24h`;
   - detail: `Verified records added through knowledge releases`.
   Keep completed pipeline stages as a secondary operational number.
2. Replace the ambiguous funnel with one stage per row or column. Show
   `completed`, `failed`, `running`, `queued`, `cancelled`, and `skipped`
   separately. Title it `Pipeline work · last 24 hours`; never render the same
   stage twice.
3. Add a full-width focal bar chart immediately below the primary metrics:
   - title: `Published knowledge by hour`;
   - subtitle: `Verified records that became published in each hour`;
   - x: `published_hourly_24h[].hour`, formatted in the browser's timezone;
   - y: `published_hourly_24h[].published`, integer starting at zero;
   - display the 24-hour total and visible timezone next to the title;
   - show essential values on focus/tap and the latest non-zero value without
     requiring hover;
   - include an accessible data table or equivalent screen-reader summary;
   - preserve zero hours instead of removing them;
   - on mobile, keep horizontal time order and use a compact 24-bar SVG without
     horizontal page scrolling.
4. The 30-day chart must use `activity_30d[].published` as its primary series.
   Do not label `revisions_created` as published.
5. During refresh errors, retain the last good series, mark it stale, and show
   the last successful update time.

Use the existing lightweight SVG approach. This view has one focal 24-point
chart, so no chart dependency is needed. No animation is required.

## BFF contract

Add these exact keys to the existing explicit safe-response allowlist:

- `published_records_24h`;
- `published_hourly_24h`;
- `cancelled`.

The nested keys `hour`, `published`, and the remaining status names are already
safe. Keep the fixed `overview` route, `no-store`, HMAC, RBAC, size limit, and
body/logging restrictions unchanged.

Add contract tests proving:

- the two new published fields survive the BFF filter;
- unknown keys and provenance are still removed;
- there are 24 chronological points and zero-value points render;
- the funnel renders each of the seven stages exactly once;
- mobile and desktop layouts pass component/Playwright coverage.

Run focused tests, TypeScript, production build, deploy the site, and return the
production URL, deployed commit SHA, and verification results.
