#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  printf 'deploy-production-remote.sh must run as root\n' >&2
  exit 1
fi

commit_sha="${1:-}"
candidate_directory="${2:-}"
release_root="${CLIDECK_MCP_RELEASE_ROOT:-/opt/clideck-mcp/releases}"
current_link="${CLIDECK_MCP_CURRENT_LINK:-/opt/clideck-mcp/current}"
config_directory="${CLIDECK_MCP_CONFIG_DIRECTORY:-/etc/clideck-mcp}"
backup_root="${CLIDECK_MCP_BACKUP_ROOT:-/var/backups/clideck-mcp}"

if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'A full 40-character Git commit SHA is required\n' >&2
  exit 1
fi

release_directory="$release_root/$commit_sha"
previous_release="$(readlink -f "$current_link")"
if [[ -z "$previous_release" || ! -d "$previous_release" ]]; then
  printf 'Current production release cannot be resolved\n' >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_directory="$backup_root/deploy-$timestamp-${commit_sha:0:7}"
install -d -m 0700 "$backup_directory"
printf '%s\n' "$previous_release" > "$backup_directory/previous-release.txt"
cp -a \
  "$config_directory/api.env" \
  "$config_directory/admin-ui.env" \
  "$config_directory/worker.env" \
  "$config_directory/researcher.env" \
  "$backup_directory/"

set -a
# shellcheck disable=SC1091
source "$config_directory/backup.env"
set +a
BACKUP_DIRECTORY="$backup_directory" \
  BACKUP_RETENTION_DAYS=36500 \
  "$previous_release/ops/scripts/backup.sh"
tar -C /etc -czf "$backup_directory/etc-clideck-mcp.tar.gz" clideck-mcp

switched=0
rollback_on_error() {
  status=$?
  trap - ERR
  set +e
  if [[ "$switched" -eq 1 ]]; then
    temporary_link="${current_link}.rollback.$$"
    ln -s "$previous_release" "$temporary_link"
    mv -Tf "$temporary_link" "$current_link"
    cp -a "$backup_directory/api.env" "$config_directory/api.env"
    cp -a "$backup_directory/admin-ui.env" "$config_directory/admin-ui.env"
    cp -a "$backup_directory/worker.env" "$config_directory/worker.env"
    cp -a "$backup_directory/researcher.env" "$config_directory/researcher.env"
    systemctl restart \
      clideck-mcp-researcher \
      clideck-mcp-worker \
      clideck-mcp-api \
      clideck-mcp-admin
  fi
  printf 'Deployment failed; production was %s\n' \
    "$([[ "$switched" -eq 1 ]] && printf 'rolled back' || printf 'not switched')" \
    >&2
  exit "$status"
}
trap rollback_on_error ERR

if [[ ! -d "$release_directory" ]]; then
  if [[ -z "$candidate_directory" || ! -d "$candidate_directory" ]]; then
    printf 'Built candidate directory is required for a new release\n' >&2
    exit 1
  fi
  mv "$candidate_directory" "$release_directory"
  chown -R root:clideck_mcp "$release_directory"
  chmod -R g+rwX,o-rwx "$release_directory"
fi

for required_path in \
  dist/entrypoints/api.js \
  dist/entrypoints/admin.js \
  dist/entrypoints/worker.js \
  dist/entrypoints/researcher.js \
  dist/cli/migrate.js \
  dist-admin/index.html \
  ops/sql/grants.sql \
  ops/scripts/smoke-test.sh; do
  if [[ ! -e "$release_directory/$required_path" ]]; then
    printf 'Release artifact is incomplete: %s\n' "$required_path" >&2
    exit 1
  fi
done

set -a
# shellcheck disable=SC1091
source "$config_directory/migrator.env"
set +a
(
  cd "$release_directory"
  /usr/local/bin/node dist/cli/migrate.js
)
sudo -u postgres psql \
  --dbname=clideck_mcp \
  --set=ON_ERROR_STOP=1 \
  < "$release_directory/ops/sql/grants.sql"

set_deployed_sha() {
  environment_file="$1"
  if grep -q '^DEPLOY_COMMIT_SHA=' "$environment_file"; then
    sed -i \
      "s/^DEPLOY_COMMIT_SHA=.*/DEPLOY_COMMIT_SHA=$commit_sha/" \
      "$environment_file"
  else
    printf 'DEPLOY_COMMIT_SHA=%s\n' "$commit_sha" >> "$environment_file"
  fi
}

set_deployed_sha "$config_directory/api.env"
set_deployed_sha "$config_directory/worker.env"
set_deployed_sha "$config_directory/researcher.env"

temporary_link="${current_link}.next.$$"
ln -s "$release_directory" "$temporary_link"
mv -Tf "$temporary_link" "$current_link"
switched=1

systemctl restart \
  clideck-mcp-researcher \
  clideck-mcp-worker \
  clideck-mcp-api \
  clideck-mcp-admin

for _attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1:8787/ready >/dev/null &&
     curl --fail --silent http://127.0.0.1:8790/admin/health >/dev/null; then
    break
  fi
  sleep 1
done

systemctl is-active --quiet \
  clideck-mcp-researcher \
  clideck-mcp-worker \
  clideck-mcp-api \
  clideck-mcp-admin

CLIDECK_MCP_BASE_URL=http://127.0.0.1:8787 \
  "$release_directory/ops/scripts/smoke-test.sh"

if [[ "$(readlink -f "$current_link")" != "$release_directory" ]]; then
  printf 'Atomic release switch did not persist\n' >&2
  exit 1
fi

switched=0
trap - ERR
printf 'DEPLOYED_SHA=%s\n' "$commit_sha"
printf 'PREVIOUS_RELEASE=%s\n' "$previous_release"
printf 'BACKUP_DIRECTORY=%s\n' "$backup_directory"
