# Domain Pack authoring

A Domain Pack teaches CliDeck MCP how to validate, store, search, and return one
kind of structured knowledge. The core keeps ownership of immutable revisions,
releases, provenance, confidence thresholds, conflict handling, and audit. A
pack cannot disable those policies.

## Create a pack

```bash
pnpm domain:create -- --id marine-science --name "Marine Science"
pnpm install --lockfile-only
pnpm domain:validate -- --id marine-science
pnpm --filter @clideck/domain-marine-science test
```

The generated package lives at `domains/<domain-id>` and is included by the pnpm
workspace. It starts with strict context, candidate, and public-record schemas,
a project-authored fixture, and a Domain Kit conformance test.

Every pack exports:

- `domainPack`, a `DomainPack` implementation;
- `conformanceFixture`, one valid context/candidate pair;
- strict Zod schemas for context, candidates, and public records.

Use `pnpm domain:validate -- --id <id> --export-dir <path>` to export four JSON
Schema 2020-12 documents for Codex, editors, or external validation.

## Contract boundaries

The manifest is versioned independently from the knowledge records:

- `schema_version` identifies the Domain Pack manifest format;
- `version` identifies the pack implementation;
- `core_compatibility` states the supported Domain Kit API range;
- every knowledge revision has its own `domain_schema_version`;
- record types and context dimensions use stable lowercase IDs.

Pack-specific data belongs in `domain_context` and `domain_payload`. Use
normalized relational columns only when a domain has a demonstrated query or
integrity need. Do not add a new core column merely to avoid defining a pack
schema.

The mapper must produce a `CoreKnowledgeCandidate`. Core then independently
enforces:

- at least 0.90 confidence for ordinary publication;
- at least 0.95 confidence for dangerous publication;
- explicit verification and provenance;
- rollback for dangerous records;
- no dangerous record classified as `safe_read_only`.

## Exact data

Do not use JavaScript `number` for values where decimal precision is part of the
fact. Store the canonical value as a validated decimal string and keep its unit,
tolerance, conditions, and method in explicit fields. Conversion and comparison
must be deterministic and unit-aware.

## Optional providers

Domain Kit exposes interfaces, not infrastructure mandates:

- `ArtifactStore` stores large media or binary artifacts. An S3 implementation
  returns a content-addressed reference; credentials stay in server-only
  configuration and never enter a knowledge payload.
- `SpatialProvider` validates coordinates and performs spatial queries. A
  PostGIS implementation keeps geometry/indexes in PostgreSQL while knowledge
  records retain stable spatial references.
- `RelationProvider` supplies typed relationships. PostgreSQL remains the
  source of truth; a graph projection may be rebuilt from immutable revisions.
- `LabValidator` records domain-specific reproducible validation with a report
  hash.

Forks should implement providers in separate workspace packages. Core updates
must not require provider credentials and must continue to work when an optional
provider is absent.

## Registration and release

Built-in packs are registered explicitly in `src/domain/domain-packs.ts`. Never
scan npm, a URL, or an upload directory and execute discovered code. A new pack
is enabled only after:

1. package typecheck and tests pass;
2. `pnpm domain:validate` passes;
3. its database catalog manifest is installed by migration;
4. sample or imported candidates pass the core publication policy;
5. existing domain regression tests still pass.

Changes to a pack schema require a version bump and migration or an adapter for
old revisions. Published revisions remain immutable.
