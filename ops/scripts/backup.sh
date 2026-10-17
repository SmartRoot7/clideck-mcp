#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is required}"
: "${BACKUP_DIRECTORY:=/var/backups/clideck-mcp}"
: "${BACKUP_RETENTION_DAYS:=14}"

install -d -m 0700 "$BACKUP_DIRECTORY"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$BACKUP_DIRECTORY/clideck-mcp-$timestamp.dump"
temporary_path="$backup_path.partial"

minimum_free_bytes="${BACKUP_MIN_FREE_BYTES:-2147483648}"
if [[ ! "$minimum_free_bytes" =~ ^[0-9]+$ ]]; then
  printf 'Invalid BACKUP_MIN_FREE_BYTES\n' >&2; exit 1
fi
backup_pid=''
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ -n "$backup_pid" ]] && kill -0 "$backup_pid" 2>/dev/null; then
    kill -TERM "$backup_pid" 2>/dev/null || true
    wait "$backup_pid" 2>/dev/null || true
  fi
  if [[ "$status" -ne 0 ]]; then rm -f -- "$temporary_path"; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
available_bytes() { df -Pk "$BACKUP_DIRECTORY" | awk 'NR==2 {printf "%.0f", $4*1024}'; }
if (( $(available_bytes) < minimum_free_bytes )); then
  printf 'BACKUP_DISK_RESERVE: insufficient free space before backup\n' >&2; exit 1
fi

pg_dump \
  --dbname="$BACKUP_DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="$temporary_path" &
backup_pid=$!
while kill -0 "$backup_pid" 2>/dev/null; do
  if (( $(available_bytes) < minimum_free_bytes )); then
    printf 'BACKUP_DISK_RESERVE: stopping only this dump before database disk space is exhausted\n' >&2
    exit 1
  fi
  sleep 1
done
wait "$backup_pid"
backup_pid=''

mv "$temporary_path" "$backup_path"
sha256sum "$backup_path" > "$backup_path.sha256"
find "$BACKUP_DIRECTORY" \
  -maxdepth 1 \
  -type f \
  -name 'clideck-mcp-*.dump*' \
  -mtime "+$BACKUP_RETENTION_DAYS" \
  -delete
