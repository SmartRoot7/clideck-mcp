# Adapting a CliDeck MCP fork with Codex

CliDeck MCP targets developers who are comfortable with GitHub, servers, and
credentials. It does not try to predict every scientific or technical data
model. Instead, Domain Kit gives a fork and its Codex a stable place to add the
required model without changing the release, safety, or audit core.

## Recommended Codex request

Use a request similar to:

```text
Work only in this CliDeck MCP fork and use the existing Domain Kit extension
points. Create a domain pack for <subject>.

1. Run the existing baseline checks.
2. Generate the pack with pnpm domain:create.
3. Define strict context, candidate, and public-record schemas.
4. Preserve exact values, units, tolerances, conditions, and evidence.
5. Add only project-owned or authorized fixtures.
6. Use optional ArtifactStore, SpatialProvider, RelationProvider, or
   LabValidator packages when the domain needs them.
7. Do not weaken immutable revisions, provenance, confidence thresholds,
   conflicts, risk rules, audit, or release activation.
8. Run pnpm domain:validate, all tests, and the production build.
9. Document migrations and rollback.
```

Tell Codex what must be exact, what the domain calls its context dimensions and
record types, and which storage services are available. Put credentials in
server-owned environment files, never in prompts, fixtures, Git, manifests, or
knowledge payloads.

## Examples

### Video-heavy domains

Implement `ArtifactStore` with S3-compatible storage. Keep the video outside
PostgreSQL and store a content hash, media type, duration, and server-resolved
artifact reference. A public response should expose only a permitted delivery
URL or abstract reference.

### Geographic knowledge

Implement `SpatialProvider` with PostGIS. Store validated SRID-aware geometry in
spatial tables and reference the immutable knowledge revision. Do not encode
coordinates as unvalidated free text.

### Formulas and proofs

Store formulas as canonical text such as LaTeX plus an explicit variable/unit
schema. Store a proof as ordered typed steps with premises, transformation, and
conclusion. Add a deterministic validator or domain lab before publication.

### Graph relationships

Implement `RelationProvider` and typed relation IDs. Keep immutable PostgreSQL
records authoritative; materialize a graph projection only for traversal and
rebuild it when a release changes.

## Keeping a fork updateable

- Put subject-specific code in `domains/<id>`.
- Put infrastructure integrations in separate provider packages.
- Prefer additive migrations.
- Declare the supported Domain Kit version in every manifest.
- Run conformance tests before merging upstream core updates.
- Never edit an old revision to match a new schema; publish a new revision.
- Keep a previous application checkout and active release available for
  rollback.

Runs through your existing local Codex setup. No separate model API integration
is required. Subject to your Codex plan and usage limits.
