#!/usr/bin/env bash
set -euo pipefail

# Owner-approved policy: one completed daily dump and one deployment backup.
# Deployment history is eligible only after the canonical rollout passes smokes.
backup_root="${1:?Backup root is required}"
deployment_keep="${2:-}"
[[ -d "$backup_root" && ! -L "$backup_root" ]] || exit 1
if pgrep -x pg_dump >/dev/null; then
  printf 'Backup retention will not compete with a running pg_dump\n' >&2
  exit 1
fi

daily_keep=''
while IFS= read -r checksum; do
  name="${checksum##*/}"
  [[ "$name" =~ ^clideck-mcp-[0-9]{8}T[0-9]{6}Z\.dump\.sha256$ ]] || continue
  [[ -f "$checksum" && ! -L "$checksum" && -s "${checksum%.sha256}" && ! -L "${checksum%.sha256}" ]] || continue
  daily_keep="$checksum"
done < <(printf '%s\n' "$backup_root"/clideck-mcp-*.dump.sha256 | sort)

# Validate retained recovery points before deleting any history. Unknown paths,
# migration snapshots and symlinks are never retention targets.
if [[ -n "$daily_keep" ]]; then
  sha256sum --check --status -- "$daily_keep"
fi
if [[ -n "$deployment_keep" ]]; then
  name="${deployment_keep##*/}"
  [[ "$name" =~ ^deploy-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7}$ && "$deployment_keep" == "$backup_root/$name" ]] || exit 1
  [[ -d "$deployment_keep" && ! -L "$deployment_keep" && -f "$deployment_keep/previous-release.txt" && ! -L "$deployment_keep/previous-release.txt" ]] || exit 1
  completed=0
  for checksum in "$deployment_keep"/clideck-mcp-*.dump.sha256; do
    [[ -f "$checksum" && ! -L "$checksum" && -s "${checksum%.sha256}" && ! -L "${checksum%.sha256}" ]] || continue
    sha256sum --check --status -- "$checksum"
    completed=1
  done
  [[ "$completed" -eq 1 ]] || exit 1
fi

if [[ -n "$daily_keep" ]]; then
  for checksum in "$backup_root"/clideck-mcp-*.dump.sha256; do
    name="${checksum##*/}"
    [[ "$name" =~ ^clideck-mcp-[0-9]{8}T[0-9]{6}Z\.dump\.sha256$ ]] || continue
    [[ "$checksum" != "$daily_keep" && -f "$checksum" && ! -L "$checksum" && -f "${checksum%.sha256}" && ! -L "${checksum%.sha256}" ]] || continue
    printf 'Remove obsolete daily backup: %s\n' "${checksum%.sha256}"
    rm -- "${checksum%.sha256}" "$checksum"
  done
fi
if [[ -n "$deployment_keep" ]]; then
  for deployment in "$backup_root"/deploy-*; do
    name="${deployment##*/}"
    [[ "$name" =~ ^deploy-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7}$ ]] || continue
    [[ "$deployment" != "$deployment_keep" && -d "$deployment" && ! -L "$deployment" && -f "$deployment/previous-release.txt" && ! -L "$deployment/previous-release.txt" ]] || continue
    printf 'Remove obsolete deployment backup: %s\n' "$deployment"
    rm -rf -- "$deployment"
  done
fi
