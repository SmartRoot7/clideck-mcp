#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is required}"
: "${BACKUP_DIRECTORY:=/var/backups/clideck-mcp}"
: "${BACKUP_RETENTION_DAYS:=14}"

install -d -m 0700 "$BACKUP_DIRECTORY"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$BACKUP_DIRECTORY/clideck-mcp-$timestamp.dump"
temporary_path="$backup_path.partial"

pg_dump \
  --dbname="$BACKUP_DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="$temporary_path"

mv "$temporary_path" "$backup_path"
sha256sum "$backup_path" > "$backup_path.sha256"
find "$BACKUP_DIRECTORY" \
  -maxdepth 1 \
  -type f \
  -name 'clideck-mcp-*.dump*' \
  -mtime "+$BACKUP_RETENTION_DAYS" \
  -delete
