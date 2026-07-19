# CliDeck MCP Agent Instructions

## Git workflow

- Use only the `main` branch for this repository.
- Commit and push project changes directly to `main`.
- Do not create feature branches, worktree branches, or pull requests unless the user explicitly requests one.
- Keep local `main` synchronized with `origin/main`.

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
