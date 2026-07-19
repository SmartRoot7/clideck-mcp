# Security

## Trust boundaries

- Public MCP input is untrusted.
- Researcher output is untrusted until schema and policy validation pass.
- Imported legacy records always enter quarantine.
- Reverse-proxy headers are accepted only from configured proxy CIDRs.
- PostgreSQL and the researcher port are never exposed publicly.

## Public-data policy

Public responses must never include source URLs, manual or document names,
quotes, source IDs, content hashes, evidence fragments, acquisition metadata, or
pipeline details. The API uses a dedicated public projection and the production
DB role has no direct access to private provenance views.

Internal provenance is minimal and mandatory:

- canonical URL and document type;
- vendor, document version, and document date;
- verification date and content hash;
- a short evidence fragment;
- revision relationship and confidence rationale.

Full manuals, private documents, and user logs are prohibited.

The public operations demo follows the same rule. It is the real admin frontend,
not a screenshot or mock, but it receives a separate strict server contract.
Sensitive fields are projected through explicit allowlists and replaced or
omitted in JSON rather than blurred or hidden in CSS. This includes
source-bearing free text, content hashes, tenant ownership, private task
linkage, and legacy provenance aliases. The public mode creates no admin
session, cannot call local admin routes, and has no server-side mutation route.
Its visible controls execute only a local read-only acknowledgement.

## Application controls

- Zod validates every external boundary.
- Request bodies are limited to 64 KiB by default.
- SQL is parameterized; dynamic identifiers are not accepted from requests.
- Public identifiers and anonymous task secrets use cryptographic randomness.
- Verification tokens use HMAC signatures, expire after 30 minutes, and contain
  only a change digest rather than raw commands.
- Access tokens are stored only as SHA-256 hashes and compared in constant time.
- Admin and researcher surfaces require separate bearer tokens.
- Rate limits are enforced in PostgreSQL and should also be enforced at
  Cloudflare.
- Logs are structured and redact authorization, cookies, tokens, passwords,
  database URLs, task access secrets, and evidence.
- Error responses are generic and carry a correlation ID.
- The application performs no outbound fetch from public input, preventing SSRF
  in the public path.
- The public demo is feature-gated, rate-limited, `no-store`, and exposes only
  mirrored GET/HEAD read models under `/public/v1/demo/*`. Source identities
  and source-bearing free text are replaced server-side with `XXXXXXXX`;
  tenant/private linkage is omitted; POST, PUT, PATCH, and DELETE are rejected
  before domain logic.
- The playground requires a site-only BFF token, explicit route allowlisting,
  a 64 KiB body ceiling, and a privacy-preserving daily client key.
- Heavy analyses are limited to 10/minute, expert tasks to 3/day, and opted-in
  contributions to 3/day per privacy key.
- Snapshot, before/after, config diff, contribution, cookie, authorization, and
  task-token fields are prohibited from logs.
- Production services use systemd sandboxing and have no Node inspector.

## Researcher controls

The researcher can lease tasks, heartbeat a lease, request bounded human input,
and submit structured candidate knowledge. It cannot publish directly. Source
URLs are validated against an HTTPS-only policy, resolved addresses are checked
against private/reserved ranges, redirects are disabled, and fetch size/time are
bounded before any future source-fetch feature may be enabled.

## Required security tests

- tenant isolation and anonymous task secret enforcement;
- task ID enumeration resistance;
- prompt-injection content remains data and never changes researcher authority;
- source/private-field redaction;
- SSRF allow/deny matrix;
- request body and bulk-extraction limits;
- rate limiting and lease ownership;
- malicious legacy documents remain quarantined.
- signed-token tampering/expiry and no false `passed` on missing output;
- sentinel secrets absent from responses, logs, and quarantine rows;
- BFF authentication, body limits, contribution re-redaction, and TTL cleanup;
- commit/report-hash binding and refusal of false runtime-lab badges.

## Quarantine

The API role cannot write `snapshot_contributions`. A separate
`clideck_mcp_quarantine` database role can access only the quarantine table. The
worker can expire and delete quarantined rows; neither the researcher nor the
public read projection can read them. Contributions require explicit consent,
are capped at 16 KiB, re-redacted on the backend, expire after 30 days, and never
publish automatically.

Report suspected vulnerabilities privately to the repository owner.
