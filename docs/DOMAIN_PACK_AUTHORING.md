# Domain Pack authoring

Packs own subject schemas, prompts, validators, fixtures and mappers in
`domains/<id>`. Core owns immutable revisions, provenance, publication/risk/
conflict policy, audit and release activation; packs cannot bypass them.

## Scaffold and validate

```bash
pnpm domain:create -- --id marine-science --name "Marine Science"
pnpm install --lockfile-only
pnpm domain:validate -- --id marine-science
pnpm --filter @clideck/domain-marine-science test
```

The workspace package exports `domainPack`, `conformanceFixture` and strict Zod
context/candidate/public-record schemas. To export four JSON Schema 2020-12
documents, add `--export-dir <path>` to `domain:validate`.

Manifest fields: `schema_version` (manifest format), `version` (implementation),
`core_compatibility` (Domain Kit API). Revisions have `domain_schema_version`;
record types/context dimensions use stable lowercase IDs. Pack data belongs in
`domain_context`/`domain_payload`; add relational columns only for demonstrated
query/integrity needs. Mappers produce `CoreKnowledgeCandidate` for independent
core validation. See [current publication semantics](ARCHITECTURE.md).

Use validated decimal strings where precision matters, with explicit units,
tolerances, conditions and methods; conversion/comparison must be deterministic.
Use only authored or authorized fixtures and document their rights.

## Providers and integration

Implement optional providers in separate workspace packages:
`ArtifactStore` (content-addressed blobs), `SpatialProvider` (validated spatial
queries), `RelationProvider` (rebuildable typed projections), `LabValidator`
(reproducible checks/report hashes). PostgreSQL remains authoritative; provider
credentials stay server-side and absence must not break core.

Register local code explicitly in `src/domain/domain-packs.ts`; never execute
packs discovered from URLs, uploads or untrusted npm packages. Before enabling:

1. Pass pack typecheck, tests and `domain:validate`.
2. Install the catalog manifest through migration.
3. Validate samples/imports through core publication policy.
4. Pass existing domain regressions and production build.

Schema changes need a version bump and migration/adapter for old revisions.
Publish new revisions; never rewrite historical ones. Existing MCP contracts
remain compatible unless an explicit versioned change is approved.
