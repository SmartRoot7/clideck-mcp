# CliDeck MCP Agent Instructions

## Git workflow

- Use only the `main` branch for this repository.
- Commit and push project changes directly to `main`.
- Do not create feature branches, worktree branches, or pull requests unless the user explicitly requests one.
- Keep local `main` synchronized with `origin/main`.

The production application host is `val@100.116.82.78` over Tailscale. Its
internal address is `10.77.0.10`. The former host `10.11.5.83` is rollback-only
and must not receive normal deployments.

## Production deployment

- Run full production deployments only with
  `ops/scripts/deploy-production.sh`.
- Do not reproduce the deployment as ad hoc SSH, SCP, migration, symlink, or
  systemctl commands.
- The script owns preflight tests, PostgreSQL backup, the Linux build, additive
  migrations, grants, pipeline pause/restore, reconciliation, stats priming,
  atomic release switching, service restart, smoke tests, and automatic
  application plus knowledge-release rollback.
- A production release must be a clean commit from `main`. Do not deploy a
  dirty working tree.
- Keep `.secrets/clideck-mcp-server.env` pointed at `100.116.82.78`; never put
  a sudo password in that file. Authorize sudo interactively before deployment.
- The one-time host move is owned only by
  `ops/scripts/migrate-production-host.sh`. Do not reproduce its database,
  secret, artifact, tunnel, or certificate transfer with ad hoc commands.

## Corrective production monitoring

- Before changing or monitoring the knowledge pipeline, read
  `docs/PIPELINE_CORRECTIVE_ACTION_LOG.md`.
- A repeated soak-test failure requires a root-cause code, schema, grant, or
  configuration fix. Do not treat a service restart as the fix.
- Record the evidence, cause, minimal correction, deployment commit, and
  post-deploy result in that log, then restart the read-only soak window.

## Domain Pack workflow

- Put subject-specific schemas, prompts, validators, fixtures, and mappers in
  `domains/<domain-id>`.
- Start with `pnpm domain:create -- --id <id> --name "<name>"`.
- Run `pnpm domain:validate -- --id <id>` before integrating a pack.
- Do not weaken or bypass core immutable revisions, provenance, publication
  thresholds, risk rules, conflict handling, audit, or release activation.
- Add storage, spatial, relation, or lab integrations as separate provider
  packages implementing Domain Kit interfaces.
- Never load and execute a pack from a URL, upload, or untrusted npm package.
- Preserve backward compatibility for existing MCP tools unless a versioned
  public contract change is explicitly approved.
