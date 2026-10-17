#!/usr/bin/env bash
set -euo pipefail
# Called only by the canonical deployment preflight. An explicit failed SHA
# authorizes cleanup of its incomplete dump; completed backups are never removed.
backup_root="${1:-/var/backups/clideck-mcp}"
failed_sha="${2:-}"
minimum_free_bytes="${BACKUP_MIN_FREE_BYTES:-2147483648}"
if [[ ! "$minimum_free_bytes" =~ ^[0-9]+$ ]]; then
  printf 'Invalid BACKUP_MIN_FREE_BYTES\n' >&2; exit 1
fi
if [[ -n "$failed_sha" && ! "$failed_sha" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'Failed backup cleanup requires a full commit SHA\n' >&2; exit 1
fi
if [[ ! -d "$backup_root" || -L "$backup_root" ]]; then
  printf 'Backup root must be an existing directory\n' >&2; exit 1
fi
if pgrep -x pg_dump >/dev/null; then
  printf 'A pg_dump is already running; preflight will not compete with it\n' >&2; exit 1
fi
if [[ -n "$failed_sha" ]]; then
  for deployment in "$backup_root"/deploy-*-${failed_sha:0:7}; do
    [[ -d "$deployment" && ! -L "$deployment" && -f "$deployment/previous-release.txt" ]] || continue
    for partial in "$deployment"/clideck-mcp-*.dump.partial; do
      [[ -f "$partial" && ! -L "$partial" && ! -e "${partial%.partial}" ]] || continue
      printf 'Remove incomplete dump from explicitly selected failed deployment: %s\n' "$partial"
      rm -- "$partial"
    done
  done
fi
latest_size=0
for checksum in "$backup_root"/deploy-*/clideck-mcp-*.dump.sha256; do
  [[ -f "$checksum" && ! -L "$checksum" ]] || continue
  dump="${checksum%.sha256}"
  [[ -f "$dump" && ! -L "$dump" ]] || continue
  size="$(wc -c < "$dump")"
  if (( size > latest_size )); then latest_size=$size; fi
done
available_bytes="$(df -Pk "$backup_root" | awk 'NR==2 {printf "%.0f", $4*1024}')"
required_bytes=$((latest_size + latest_size / 2 + minimum_free_bytes))
printf 'Backup space: available=%s required=%s reserve=%s bytes\n' "$available_bytes" "$required_bytes" "$minimum_free_bytes"
if (( available_bytes < required_bytes )); then
  printf 'BACKUP_INSUFFICIENT_FREE_SPACE: keep completed backups; provide disk capacity before retrying\n' >&2
  exit 1
fi
