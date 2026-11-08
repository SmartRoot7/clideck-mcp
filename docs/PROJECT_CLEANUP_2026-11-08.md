# Project cleanup — 2026-11-08

Baseline: `6c3ad6d` on `main`, initially clean and synchronized with `origin/main`.
Inventory: 415 tracked files, plus local ignored directories. Reviewed
Markdown instructions/contracts, file references, package/TypeScript/Vite/CI
entry points, deployment inputs, and running local process paths. This was a
file/dependency cleanup, not a line-by-line correctness audit of the application.

## Removed

14 tracked historical files and 76 ignored temporary files:
**4,562,684 bytes (4.35 MiB) of file contents**;
**4,804,608 bytes (4.58 MiB) of allocated file blocks** before unlink.
After documentation edits and this report, net file-content reduction is about
4.34 MiB, excluding Git metadata. APFS snapshots, clones,
compression and concurrent pipeline writes mean this is not a guaranteed change
in whole-volume free space. Git history is retained; removed tracked content
remains recoverable from the baseline commit.

Completed contest plans/checklists/scripts duplicate maintained WebMCP and
architecture documentation. The implemented execution-settings plan duplicates
Researcher automation and current code. Three old mockup/concept images have no
runtime references. Documentation links now point to maintained contracts; public
demo/submission URLs are preserved in WebMCP.

Temporary files are top-level ignored validation logs, snapshots and a generated
TypeScript config last modified before October 19. None is named in tracked
content. Operational evidence cited by maintained documents is retained. No
recursive deletion of `tmp/` or `artifacts/` was performed.

## Preserved

- Application/package/domain/template source, tests, all 53 migrations, lockfile,
  CI, deployment/recovery scripts and current build outputs/dependencies.
- Agent rules, operational/security/API contracts, ADR and corrective action log.
- September 30 learning audit, publication/operations receipts, host migration
  state, recent diagnostics and unresolved technical research drafts.
- All `.secrets/`, active `tmp/pipeline/`, lease state, pool/tunnel logs. Four
  promotion clones contain commits not represented in their remote refs;
  they cannot be proven disposable from local evidence.
- Production services and data; no deployment or restart is part of this cleanup.

## Validation

Validated under Node 24.22.1:

- `pnpm check`: passed (all packages and frontend).
- `pnpm test`: passed, 275 tests across backend, Domain Kit/packs and frontend;
  150 PostgreSQL-dependent tests skipped because `DATABASE_URL` was not supplied.
  Docker Engine is unavailable; no database integration/eval pass is claimed.
- `pnpm build`: passed (backend, workspace packages and frontend); Vite retains
  its existing advisory warning about chunks over 500 kB.
- All maintained relative Markdown links resolve; all 90 selected files are absent.
- `git diff --check`: passed; tracked changes restricted to docs/assets and report.

No application, dependency, migration, environment or network configuration changed.

## Exact removed paths

Paths below are recorded as text because the files have been removed.

| Path | Bytes | Kind |
| --- | ---: | --- |
| `devpost-submission.md` | 1200 | Historical |
| `docs/BUILD_WEEK_EXECUTION_PLAN.md` | 1706 | Historical |
| `docs/MCP_0_8_MODERNIZATION_PLAN.md` | 1978 | Historical |
| `docs/PIPELINE_EXECUTION_SETTINGS_PLAN.md` | 21168 | Historical |
| `docs/hackathon-build/assets/network-evidence-workbench-concept.png` | 1368857 | Historical |
| `docs/hackathon-build/build-notes.md` | 1142 | Historical |
| `docs/hackathon-build/checklist.md` | 392 | Historical |
| `docs/hackathon-build/demo-script.md` | 1043 | Historical |
| `docs/hackathon-build/demo-voiceover-en.md` | 1452 | Historical |
| `docs/hackathon-build/prd.md` | 414 | Historical |
| `docs/hackathon-build/spec.md` | 333 | Historical |
| `docs/hackathon-build/webmcp-evals.md` | 395 | Historical |
| `docs/design/admin-overview-v0.3.png` | 1339984 | Historical |
| `docs/design/admin-pipeline-v0.3.png` | 1346639 | Historical |
| `tmp/backup-space-final-tests.log` | 223 | Temporary |
| `tmp/backup-space-tests.log` | 223 | Temporary |
| `tmp/client-error-acceptance-1.json` | 4361 | Temporary |
| `tmp/client-error-acceptance-2.json` | 4640 | Temporary |
| `tmp/client-error-final-services.log` | 19315 | Temporary |
| `tmp/client-error-fresh-journal.log` | 9815 | Temporary |
| `tmp/deploy-20261009-client-error.log` | 46941 | Temporary |
| `tmp/diagnosis-format-tests.log` | 225 | Temporary |
| `tmp/final-learning-build.log` | 6752 | Temporary |
| `tmp/final-learning-check.log` | 1147 | Temporary |
| `tmp/final-learning-db-tests.log` | 9128 | Temporary |
| `tmp/final-learning-full-tests.log` | 12005 | Temporary |
| `tmp/final-learning-types.log` | 0 | Temporary |
| `tmp/final-technical-deploy.log` | 49128 | Temporary |
| `tmp/learning-admin-tests.log` | 257 | Temporary |
| `tmp/learning-baseline.txt` | 5518 | Temporary |
| `tmp/learning-build.log` | 6654 | Temporary |
| `tmp/learning-check.log` | 942 | Temporary |
| `tmp/learning-db-tests.log` | 8815 | Temporary |
| `tmp/learning-deploy-final.log` | 27666 | Temporary |
| `tmp/learning-deploy-verified.log` | 47104 | Temporary |
| `tmp/learning-deploy.log` | 15997 | Temporary |
| `tmp/learning-eval.log` | 867 | Temporary |
| `tmp/learning-fairness-after.log` | 227 | Temporary |
| `tmp/learning-fairness-before.log` | 5897 | Temporary |
| `tmp/learning-fairness-deploy.log` | 287 | Temporary |
| `tmp/learning-fairness-eval.log` | 304 | Temporary |
| `tmp/learning-fairness-full-setup-v2.log` | 9732 | Temporary |
| `tmp/learning-fairness-full-setup.log` | 9732 | Temporary |
| `tmp/learning-fairness-full-tests-v2.log` | 2799 | Temporary |
| `tmp/learning-fairness-full-tests.log` | 4816 | Temporary |
| `tmp/learning-fairness-setup.log` | 9732 | Temporary |
| `tmp/learning-fairness-typecheck.log` | 1147 | Temporary |
| `tmp/learning-followup-health.jsonl` | 4367 | Temporary |
| `tmp/learning-followup-journal.jsonl` | 38620 | Temporary |
| `tmp/learning-full-tests.log` | 11182 | Temporary |
| `tmp/learning-github-keyscan.log` | 0 | Temporary |
| `tmp/learning-regression-before.log` | 1669 | Temporary |
| `tmp/learning-space-recovery.log` | 453 | Temporary |
| `tmp/learning-tests-no-db.log` | 2027 | Temporary |
| `tmp/learning-unit-tests.log` | 226 | Temporary |
| `tmp/mixed-evidence-after.log` | 227 | Temporary |
| `tmp/mixed-evidence-before.log` | 985 | Temporary |
| `tmp/mixed-evidence-setup.log` | 9880 | Temporary |
| `tmp/mixed-evidence-types.log` | 1147 | Temporary |
| `tmp/publication-concurrency.log` | 238 | Temporary |
| `tmp/publication-eval.log` | 305 | Temporary |
| `tmp/publication-full-fresh.log` | 2801 | Temporary |
| `tmp/publication-full-setup.log` | 9732 | Temporary |
| `tmp/publication-full-tests.log` | 5690 | Temporary |
| `tmp/publication-lock-deploy-approved.log` | 1925 | Temporary |
| `tmp/publication-lock-deploy.log` | 287 | Temporary |
| `tmp/publication-readiness-contract.log` | 224 | Temporary |
| `tmp/publication-regression-after.log` | 227 | Temporary |
| `tmp/publication-regression-before.log` | 2265 | Temporary |
| `tmp/publication-regression-reindex.log` | 564 | Temporary |
| `tmp/publication-regression-setup.log` | 9232 | Temporary |
| `tmp/publication-typecheck.log` | 1147 | Temporary |
| `tmp/technical-bindings-check.log` | 0 | Temporary |
| `tmp/technical-check.log` | 1147 | Temporary |
| `tmp/technical-db-tests.log` | 8969 | Temporary |
| `tmp/technical-deploy.log` | 21568 | Temporary |
| `tmp/technical-draft-check.log` | 0 | Temporary |
| `tmp/technical-draft-tests.log` | 282 | Temporary |
| `tmp/technical-draft-tsconfig.json` | 679 | Temporary |
| `tmp/technical-final-check.log` | 1147 | Temporary |
| `tmp/technical-full-tests.log` | 11845 | Temporary |
| `tmp/technical-install.log` | 289 | Temporary |
| `tmp/technical-metadata-check.log` | 1147 | Temporary |
| `tmp/technical-metadata-regressions.log` | 227 | Temporary |
| `tmp/technical-metadata-tests.log` | 221 | Temporary |
| `tmp/technical-metadata-types.log` | 0 | Temporary |
| `tmp/technical-scaffold.log` | 99 | Temporary |
| `tmp/technical-types.log` | 0 | Temporary |
| `tmp/technical-unit.log` | 222 | Temporary |
| `tmp/technical-validation.log` | 323 | Temporary |
