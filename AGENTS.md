# CliDeck MCP agent rules

- Use only `main`; commit/push directly and keep `origin/main` synchronized.
  Create branches, worktrees or PRs only on explicit request.
- The hackathon freeze is lifted: edits, commits, pushes and deployments are
  allowed under these rules. Load only task-relevant [docs](docs/README.md);
  historical plans are not startup instructions or active tasks.

## Production

- Host: `val@100.116.82.78` (Tailscale), internal `10.77.0.10`.
  Former `10.11.5.83` is rollback-only, never a normal deployment target.
- Deploy a **clean `main` commit** only via `ops/scripts/deploy-production.sh`.
  It owns tests/build, backups, migrations/grants, reconciliation/stats,
  pause/restore, atomic switch, restarts, smokes and application/knowledge rollback.
  Never reproduce deployment with ad hoc SSH/SCP/SQL/symlink/systemctl steps.
- `.secrets/clideck-mcp-server.env` must target `100.116.82.78`. Never store a
  sudo password; authorize remote sudo interactively before deploying.
- Host moves use only `ops/scripts/migrate-production-host.sh`, never ad hoc
  database/secret/artifact/tunnel/certificate transfers. See [operations](docs/OPERATIONS.md).

## Pipeline

- Before changes/monitoring, read [corrective log](docs/PIPELINE_CORRECTIVE_ACTION_LOG.md).
  Repeated soak failures need a root-cause code/schema/grant/config fix, not a
  restart. Record evidence, cause, correction, deployed SHA and result; restart
  the read-only soak window after correction.
- Fill all eight physical Luna lanes with useful work. No global single-task or
  stage cap: discovery, demand, analysis, verification and review may use every
  free lane. `next_check_at` orders refreshes; it never blocks idle capacity.
- No throughput cooldowns, daily quotas, cost throttles or queue blockers without
  explicit user approval. Preserve per-item dedupe, transactional leases, bounded
  context, official-source policy, scoped circuits and operator Pause/Resume.

## Packs and core integrity

- Subject schemas/prompts/validators/fixtures/mappers: `domains/<id>`.
  Scaffold `pnpm domain:create -- --id <id> --name "<name>"`; validate with
  `pnpm domain:validate -- --id <id>` before integration.
- Providers implement Domain Kit interfaces in separate packages. Never execute
  packs from URLs, uploads or untrusted npm packages.
- Preserve immutable revisions, provenance, publication thresholds, risk/conflict
  rules, audit and release activation. Preserve MCP compatibility unless a
  versioned public-contract change is explicitly approved.
