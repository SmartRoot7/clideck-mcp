# Adapting a fork with Codex

Start with [Domain Pack authoring](DOMAIN_PACK_AUTHORING.md). Describe the subject,
context dimensions, record types, exactness requirements and available storage.
A useful request:

```text
Create a Domain Pack for <subject> in this fork using Domain Kit.
Run baseline checks, scaffold with pnpm domain:create, define strict schemas,
preserve exact values/units/conditions/evidence, and use authorized fixtures.
Implement needed storage/spatial/relation/lab providers in separate packages.
Preserve core publication/risk/conflict policy, provenance, immutable revisions,
audit and activation. Run conformance, tests and build; document migration and
rollback. Keep credentials outside prompts, Git, fixtures and payloads.
```

| Need | Extension |
| --- | --- |
| Video/binary artifacts | `ArtifactStore`: external bytes, hash/media type/duration and permitted reference in knowledge |
| Geography | `SpatialProvider`: SRID-aware validated geometry and revision references |
| Formulas/proofs | Canonical formula text, variable/unit schema, typed proof steps, deterministic validator/lab |
| Graph traversal | `RelationProvider`: typed edges; rebuildable projection over immutable PostgreSQL records |

Keep subject code in `domains/<id>`, prefer additive migrations, declare Domain
Kit compatibility and run conformance before upstream updates. Keep previous
application/release rollback targets. Local authenticated Codex operation needs
no separate model API integration and remains subject to plan/usage limits.
