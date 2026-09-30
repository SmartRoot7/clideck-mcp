# Security boundaries

## Untrusted inputs and privileges

Public requests, source text, model artifacts and legacy imports are untrusted.
Validate external boundaries with Zod, parameterize SQL, quarantine legacy
imports and enforce tenant/lease ownership. Treat embedded instructions as data.
Trust forwarded headers only from configured proxy CIDRs.

PostgreSQL, researcher and application listeners stay loopback-only. Researcher
uses a separate bearer token and bounded bridge; it cannot administer the host.
API/admin/worker/researcher/quarantine roles have explicit least-privilege grants
in `ops/sql/grants.sql`. Validate the actual roles in disposable PostgreSQL tests.
Services use systemd sandboxing; no production Node inspector.

## Public projections

Ordinary knowledge responses omit private evidence/provenance. The explicit
`get_knowledge_provenance` tool is an exception: for at most five **active** public
revision refs it returns source kind/ref, title, HTTPS URL or first-party locator,
document version/date and verification date. It exposes no evidence text,
content hashes, uploaded bytes or credentials. See `src/domain/provenance.ts`.

The public operations demo has a separate, stricter projection: source identity,
hashes, evidence and source-bearing text become `XXXXXXXX`; tenant/private
linkage is omitted. It serves the same UI and real counters as admin, with no
admin session. GET/HEAD only under `/public/v1/demo/*`; all mutation methods are
rejected before domain logic. Demo actions return local acknowledgements.
`ENABLE_PUBLIC_DEMO` gates routes; responses are rate-limited and `no-store`.

## Evidence, retention and logs

- Internal provenance binds revisions to source identity, verification date,
  hash and bounded evidence. It is mandatory and access-restricted.
- Worker source artifacts and authorized local intake are supported under
  configured retention. Public source locators expose metadata, not uploads.
  Field logs are sanitized before immutable storage; raw staging is deleted.
- WebMCP complete files stay in browser memory. Only selected redacted evidence
  is transmitted; browser-agent access is opt-in. Operational identifiers may
  remain visible as disclosed in [WebMCP](WEBMCP.md).
- Snapshot analysis is in-memory. Its request journal stores metadata only:
  redacted-input hash/byte count, types, redaction counts, outcome/timing/error.
- Other MCP request journaling uses bounded sanitized projections and retention;
  exact client addresses are local-super-admin-only and redacted in demo.
- Application logs redact credentials, authorization/cookies, DB URLs, task
  secrets and evidence; do not log raw snapshots, configs, diffs or contributions.
- Opt-in snapshot contributions: max 16 KiB, backend re-redaction, separate
  quarantine DB role, 30-day expiry, no automatic publication. Worker may expire
  rows; researcher/public projections cannot read them.

## Request and fetch controls

Default public/admin JSON limit: 64 KiB. The authenticated loopback researcher
bridge permits 1 MiB artifacts; streamed local intake has separate limits.
Public IDs and task secrets are cryptographically random; access secrets are
hashed and compared safely. Verification credentials expire; missing output
must not yield a false success. Errors expose a generic code/correlation ID.

Public requests do not directly fetch arbitrary URLs. Worker acquisition checks
HTTPS and public DNS/IP destinations on every redirect (up to five), with pinned
safe lookup, MIME, size/decompression and timeout bounds. Collection scope and
official-source rules remain enforced. See `src/domain/pipeline-worker.ts`.

The website playground is BFF-only with fixed routes, a site bearer token and
daily HMAC client key; no browser cookies/auth/IP forwarding or body logging.
[Playground API](PLAYGROUND_API.md) defines rate limits. Remote admin additionally
uses signed actor/role envelopes, RBAC and nonce replay protection.

## Verification

Cover tenant/anonymous-secret isolation; enumeration resistance; prompt injection;
public/demo redaction with sentinel secrets; SSRF/redirect/scope boundaries;
body/rate limits; leases and exact grants; quarantine/TTL; token expiry/tampering;
WebMCP sharing/cancellation; and commit/hash binding for lab assurance.
Report suspected vulnerabilities privately to the repository owner.
