#!/usr/bin/env bash
set -Eeuo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

phase="${1:-}"
old_host="${CLIDECK_MCP_OLD_HOST:-10.11.5.83}"
new_host="${CLIDECK_MCP_NEW_HOST:-100.116.82.78}"
old_user="${CLIDECK_MCP_OLD_USER:-val}"
new_user="${CLIDECK_MCP_NEW_USER:-val}"
state_root="${CLIDECK_MCP_MIGRATION_STATE_DIR:-$repository_root/tmp/production-host-migration}"
commit_sha="$(git rev-parse HEAD)"
old_remote="$old_user@$old_host"
new_remote="$new_user@$new_host"
ssh_options=(
  -o BatchMode=yes
  -o ConnectTimeout=10
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=2
)

usage() {
  printf '%s\n' \
    'Usage: ops/scripts/migrate-production-host.sh PHASE' \
    'PHASE: preflight | prepare | rehearsal | cutover | verify | rollback'
}

checkpoint() {
  install -d -m 0700 "$state_root"
  printf '%s %s\n' "$commit_sha" "$(date -u +%FT%TZ)" \
    > "$state_root/$1.complete"
}

require_checkpoint() {
  if [[ ! -f "$state_root/$1.complete" ]]; then
    printf 'Required migration phase has not completed: %s\n' "$1" >&2
    exit 1
  fi
  checkpoint_commit="$(awk 'NR == 1 { print $1 }' "$state_root/$1.complete")"
  if [[ "$checkpoint_commit" != "$commit_sha" ]]; then
    printf 'Migration checkpoint %s belongs to commit %s, not %s.\n' \
      "$1" "$checkpoint_commit" "$commit_sha" >&2
    exit 1
  fi
}

remote() {
  destination="$1"
  shift
  ssh "${ssh_options[@]}" "$destination" "$@"
}

require_sudo() {
  destination="$1"
  if ! remote "$destination" sudo -n true; then
    printf 'Run sudo -v on %s before continuing.\n' "$destination" >&2
    exit 1
  fi
}

replace_env_value() {
  path="$1"
  key="$2"
  value="$3"
  temporary_path="$path.tmp.$$"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 { print key "=" value; replaced = 1; next }
    { print }
    END { if (!replaced) print key "=" value }
  ' "$path" > "$temporary_path"
  original_mode="$(
    stat -f '%Lp' "$path" 2>/dev/null || stat -c '%a' "$path"
  )"
  chmod "$original_mode" "$temporary_path"
  mv "$temporary_path" "$path"
}

preflight() {
  for command_name in git pnpm ssh scp curl sha256sum; do
    command -v "$command_name" >/dev/null || {
      printf 'Missing local command: %s\n' "$command_name" >&2
      exit 1
    }
  done
  [[ "$(git branch --show-current)" == 'main' ]] || {
    printf 'Host migration is allowed only from main.\n' >&2
    exit 1
  }
  [[ -z "$(git status --porcelain)" ]] || {
    printf 'Commit local changes before host migration.\n' >&2
    exit 1
  }
  [[ "$old_host" == '10.11.5.83' && "$new_host" == '100.116.82.78' ]] || {
    printf 'Unexpected migration endpoints.\n' >&2
    exit 1
  }
  [[ "$(remote "$old_remote" hostname)" == 'clideck-mcp' ]]
  [[ "$(remote "$new_remote" hostname)" == 'clideck-mcp' ]]
  require_sudo "$old_remote"
  require_sudo "$new_remote"
  deployed_release="$(remote "$old_remote" sudo -n readlink -f /opt/clideck-mcp/current)"
  source_release_sha="${deployed_release##*/}"
  git cat-file -e "$source_release_sha^{commit}" 2>/dev/null || {
    printf 'Old production release is not present in the local repository.\n' >&2
    exit 1
  }
  git merge-base --is-ancestor "$source_release_sha" "$commit_sha" || {
    printf 'Old production release is not an ancestor of local HEAD.\n' >&2
    exit 1
  }
  available_bytes="$(remote "$new_remote" df -B1 --output=avail / | tail -n1 | tr -d ' ')"
  (( available_bytes >= 100000000000 )) || {
    printf 'New host has less than 100 GB free.\n' >&2
    exit 1
  }
  remote "$old_remote" systemctl is-active --quiet \
    postgresql clideck-mcp-api clideck-mcp-worker \
    clideck-mcp-researcher cloudflared
  remote "$new_remote" tailscale ip -4 | grep -qx '100.116.82.78'
  curl --fail --silent --show-error https://mcp.clideck.com/ready >/dev/null
  checkpoint preflight
  printf 'Migration preflight passed for %s.\n' "$commit_sha"
}

prepare() {
  require_checkpoint preflight
  temporary_directory="$(mktemp -d)"
  trap 'rm -rf "$temporary_directory"' EXIT
  archive="$temporary_directory/clideck-mcp-$commit_sha.tar.gz"
  git archive --format=tar.gz --output="$archive" "$commit_sha"
  scp -q "${ssh_options[@]}" "$archive" \
    "$new_remote:/tmp/clideck-mcp-$commit_sha.tar.gz"
  remote "$new_remote" bash -s -- "$commit_sha" <<'REMOTE'
set -Eeuo pipefail
commit_sha="$1"
candidate="/tmp/clideck-mcp-provision-$commit_sha"
rm -rf "$candidate"
mkdir -p "$candidate"
tar -xzf "/tmp/clideck-mcp-$commit_sha.tar.gz" -C "$candidate"
sudo -n /bin/bash "$candidate/ops/scripts/provision-production-host.sh" \
  "$commit_sha" "$candidate"
rm -f "/tmp/clideck-mcp-$commit_sha.tar.gz"
REMOTE
  remote "$new_remote" sudo -n test -f \
    "/opt/clideck-mcp/current/dist/entrypoints/api.js"
  checkpoint prepare
  printf 'New host prepared with release %s.\n' "$commit_sha"
}

create_snapshot() {
  label="$1"
  remote "$old_remote" sudo -n bash -s -- "$label" <<'REMOTE'
set -Eeuo pipefail
label="$1"
snapshot="/var/backups/clideck-mcp/host-migration/$label"
temporary_dump="/tmp/clideck-mcp-$label-$$.dump"
rm -rf "$snapshot"
install -d -m 0700 "$snapshot"
coproc SNAPSHOT_HOLDER { sudo -u postgres psql -XqAt -d clideck_mcp; }
printf '%s\n' \
  'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;' \
  'SELECT pg_export_snapshot();' >&"${SNAPSHOT_HOLDER[1]}"
IFS= read -r database_snapshot <&"${SNAPSHOT_HOLDER[0]}"
[[ "$database_snapshot" =~ ^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$ ]]
release_database_snapshot() {
  set +e
  printf '%s\n' 'ROLLBACK;' '\q' >&"${SNAPSHOT_HOLDER[1]}"
  wait "$SNAPSHOT_HOLDER_PID"
  rm -f "$temporary_dump"
}
trap release_database_snapshot EXIT
sudo -u postgres pg_dump \
  --dbname=clideck_mcp --format=custom --compress=9 \
  --no-owner --no-privileges --snapshot="$database_snapshot" \
  --file="$temporary_dump"
install -m 0600 -o postgres -g postgres \
  "$temporary_dump" "$snapshot/database.dump"
sudo -u postgres pg_dumpall --roles-only |
  awk '/^(CREATE ROLE|ALTER ROLE) clideck_mcp_/' > "$snapshot/roles.sql"
sudo -u postgres psql -XqAt -P pager=off -d clideck_mcp \
  --set=database_snapshot="$database_snapshot" <<'SQL' \
  > "$snapshot/baseline.txt"
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET TRANSACTION SNAPSHOT :'database_snapshot';
SELECT 'active_release|' || to_jsonb(t)::text FROM active_release t;
SELECT 'pipeline_settings|' || to_jsonb(t)::text FROM pipeline_settings t;
COMMIT;
SQL
sudo -u postgres psql -XqAt -P pager=off -d clideck_mcp \
  --set=database_snapshot="$database_snapshot" <<'SQL' \
  > "$snapshot/row-counts.txt"
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET TRANSACTION SNAPSHOT :'database_snapshot';
SELECT 'active_knowledge_state|' || count(*) FROM active_knowledge_state
UNION ALL SELECT 'agent_runs|' || count(*) FROM agent_runs
UNION ALL SELECT 'knowledge_items|' || count(*) FROM knowledge_items
UNION ALL SELECT 'knowledge_revisions|' || count(*) FROM knowledge_revisions
UNION ALL SELECT 'pipeline_tasks|' || count(*) FROM pipeline_tasks
UNION ALL SELECT 'source_artifacts|' || count(*) FROM source_artifacts
UNION ALL SELECT 'source_candidates|' || count(*) FROM source_candidates
ORDER BY 1;
COMMIT;
SQL
sudo -u postgres psql -XqAt -P pager=off -d clideck_mcp \
  --set=database_snapshot="$database_snapshot" <<'SQL' \
  > "$snapshot/pipeline-state.json"
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET TRANSACTION SNAPSHOT :'database_snapshot';
SELECT json_build_object(
    'enabled', enabled,
    'paused_reason', paused_reason,
    'max_concurrent_ai_runs', max_concurrent_ai_runs,
    'max_deep_review_runs', max_deep_review_runs
  )::text FROM pipeline_settings WHERE singleton;
COMMIT;
SQL
release_database_snapshot
set -e
trap - EXIT
printf '%s\n' 'postgres-exported-snapshot-v1' \
  > "$snapshot/snapshot-consistency.txt"
(
  cd /
  find var/lib/clideck-mcp/source-artifacts -type f -print0 |
    LC_ALL=C sort -z |
    xargs -0 --no-run-if-empty sha256sum
) > "$snapshot/source-artifacts.sha256"
if [[ "$label" == 'rehearsal' ]]; then
  tar -C / -czf "$snapshot/state.tar.gz" \
    etc/clideck-mcp \
    etc/cloudflared/token \
    var/lib/clideck-mcp/source-artifacts \
    var/lib/caddy/.local/share/caddy/pki
  tar -czf "$snapshot/source-artifacts-delta.tar.gz" --files-from /dev/null
else
  previous_artifact_manifest=\
'/var/backups/clideck-mcp/host-migration-rehearsal-source-artifacts.sha256'
  [[ -f "$previous_artifact_manifest" ]] || {
    printf 'The persistent rehearsal artifact manifest is missing.\n' >&2
    exit 1
  }
  tar -C / -czf "$snapshot/state.tar.gz" \
    etc/clideck-mcp \
    etc/cloudflared/token \
    var/lib/caddy/.local/share/caddy/pki
  comm -13 \
    <(LC_ALL=C sort "$previous_artifact_manifest") \
    <(LC_ALL=C sort "$snapshot/source-artifacts.sha256") |
    sed -E 's/^[0-9a-f]{64}  //' > "$snapshot/source-artifacts-delta.txt"
  tar -C / -czf "$snapshot/source-artifacts-delta.tar.gz" \
    --files-from "$snapshot/source-artifacts-delta.txt"
  rm -f "$snapshot/source-artifacts-delta.txt"
fi
(
  cd "$snapshot"
  sha256sum database.dump roles.sql state.tar.gz \
    source-artifacts-delta.tar.gz baseline.txt row-counts.txt \
    source-artifacts.sha256 pipeline-state.json snapshot-consistency.txt \
    > manifest.sha256
  sha256sum -c manifest.sha256
)
chown -R val:val "$snapshot"
chmod -R u=rwX,go= "$snapshot"
rm -rf "/tmp/clideck-migration-$label"
mv "$snapshot" "/tmp/clideck-migration-$label"
REMOTE
}

transfer_snapshot() {
  label="$1"
  transfer_directory="$(mktemp -d)"
  trap 'rm -rf "$transfer_directory"' EXIT
  snapshot_files=(
    database.dump roles.sql state.tar.gz source-artifacts-delta.tar.gz
    baseline.txt row-counts.txt source-artifacts.sha256
    pipeline-state.json snapshot-consistency.txt manifest.sha256
  )
  local_snapshot="$transfer_directory/clideck-migration-$label"
  mkdir -m 0700 "$local_snapshot"
  copy_failed=0
  copy_pids=()
  for snapshot_file in "${snapshot_files[@]}"; do
    scp -q "${ssh_options[@]}" \
      "$old_remote:/tmp/clideck-migration-$label/$snapshot_file" \
      "$local_snapshot/$snapshot_file" &
    copy_pids+=("$!")
  done
  for copy_pid in "${copy_pids[@]}"; do
    wait "$copy_pid" || copy_failed=1
  done
  [[ "$copy_failed" -eq 0 ]] || {
    printf 'Parallel transfer from the old host failed.\n' >&2
    exit 1
  }
  (
    cd "$local_snapshot"
    sha256sum -c manifest.sha256
  )
  remote "$new_remote" rm -rf "/tmp/clideck-migration-$label"
  remote "$new_remote" mkdir -m 0700 "/tmp/clideck-migration-$label"
  scp -q "${ssh_options[@]}" "$local_snapshot/manifest.sha256" \
    "$new_remote:/tmp/clideck-migration-$label/manifest.sha256"
  reusable_snapshot_files="$(
    remote "$new_remote" sudo -n bash -s -- "$label" <<'REMOTE'
set -Eeuo pipefail
label="$1"
existing="/var/backups/clideck-mcp/host-migration/$label"
staging="/tmp/clideck-migration-$label"
for snapshot_file in \
  database.dump roles.sql state.tar.gz source-artifacts-delta.tar.gz \
  baseline.txt row-counts.txt source-artifacts.sha256 pipeline-state.json \
  snapshot-consistency.txt; do
  expected="$(
    awk -v file="$snapshot_file" '$2 == file { print $1 }' \
      "$staging/manifest.sha256"
  )"
  if [[ -n "$expected" && -f "$existing/$snapshot_file" ]] &&
     [[ "$(sha256sum "$existing/$snapshot_file" | cut -d' ' -f1)" == "$expected" ]]; then
    cp "$existing/$snapshot_file" "$staging/$snapshot_file"
    chown val:val "$staging/$snapshot_file"
    printf '%s\n' "$snapshot_file"
  fi
done
REMOTE
  )"
  copy_failed=0
  copy_pids=()
  for snapshot_file in "${snapshot_files[@]}"; do
    [[ "$snapshot_file" == 'manifest.sha256' ]] && continue
    if grep -Fxq "$snapshot_file" <<< "$reusable_snapshot_files"; then
      continue
    fi
    scp -q "${ssh_options[@]}" "$local_snapshot/$snapshot_file" \
      "$new_remote:/tmp/clideck-migration-$label/$snapshot_file" &
    copy_pids+=("$!")
  done
  for copy_pid in "${copy_pids[@]}"; do
    wait "$copy_pid" || copy_failed=1
  done
  [[ "$copy_failed" -eq 0 ]] || {
    printf 'Parallel transfer to the new host failed.\n' >&2
    exit 1
  }
  remote "$new_remote" sudo -n bash -s -- "$label" <<'REMOTE'
set -Eeuo pipefail
label="$1"
destination="/var/backups/clideck-mcp/host-migration/$label"
install -d -m 0700 -o clideck_mcp_backup -g clideck_mcp \
  /var/backups/clideck-mcp/host-migration
rm -rf "$destination"
mv "/tmp/clideck-migration-$label" "$destination"
chown -R root:root "$destination"
chown root:postgres "$destination"
chown postgres:postgres "$destination/database.dump" "$destination/roles.sql"
chmod 0710 "$destination"
find "$destination" -maxdepth 1 -type f -exec chmod 0600 {} +
cd "$destination"
sha256sum -c manifest.sha256
REMOTE
}

return_to_rollback_host() {
  set +e
  pnpm pipeline:pool-stop >/dev/null 2>&1
  remote "$new_remote" sudo -n systemctl stop \
    cloudflared clideck-mcp-worker clideck-mcp-researcher \
    clideck-mcp-api clideck-mcp-admin >/dev/null 2>&1
  if [[ -f "$state_root/original-pipeline-state.json" ]]; then
    scp -q "${ssh_options[@]}" "$state_root/original-pipeline-state.json" \
      "$old_remote:/tmp/original-pipeline-state.json"
    remote "$old_remote" sudo -n bash -s <<'REMOTE'
set -Eeuo pipefail
set -a
source /etc/clideck-mcp/migrator.env
set +a
psql "$DATABASE_URL" --set=ON_ERROR_STOP=1 \
  --set=migration_pipeline_state="$(cat /tmp/original-pipeline-state.json)" <<'SQL'
UPDATE pipeline_settings
SET enabled = (:'migration_pipeline_state'::jsonb ->> 'enabled')::boolean,
    paused_reason = nullif(:'migration_pipeline_state'::jsonb ->> 'paused_reason', ''),
    pause_requested_at = NULL,
    max_concurrent_ai_runs =
      (:'migration_pipeline_state'::jsonb ->> 'max_concurrent_ai_runs')::smallint,
    max_deep_review_runs =
      (:'migration_pipeline_state'::jsonb ->> 'max_deep_review_runs')::smallint,
    control_generation = control_generation + 1,
    updated_at = now(),
    updated_by = 'migrate-production-host-rollback'
WHERE singleton;
SQL
rm -f /tmp/original-pipeline-state.json
REMOTE
  fi
  remote "$old_remote" sudo -n systemctl start \
    clideck-mcp-api clideck-mcp-admin clideck-mcp-researcher \
    clideck-mcp-worker caddy cloudflared clideck-mcp-backup.timer
  replace_env_value .secrets/researcher-bridge.env \
    CLIDECK_RESEARCHER_SSH_HOST "$old_host"
  replace_env_value .secrets/clideck-mcp-server.env CLIDECK_MCP_HOST "$old_host"
  pnpm pipeline:install-launchd
  pnpm pipeline:pool-start
  set -e
  remote "$old_remote" sudo -n systemctl is-active --quiet \
    postgresql caddy cloudflared clideck-mcp-api clideck-mcp-admin \
    clideck-mcp-worker clideck-mcp-researcher
}

cutover_failed() {
  status="$1"
  trap - ERR
  printf 'Cutover failed; returning traffic and executors to the old host.\n' >&2
  return_to_rollback_host
  exit "$status"
}

rehearsal() {
  require_checkpoint prepare
  if ! remote "$new_remote" sudo -n bash -c \
    "'cd /var/backups/clideck-mcp/host-migration/rehearsal &&
      test \"\$(cat snapshot-consistency.txt)\" = postgres-exported-snapshot-v1 &&
      sha256sum -c manifest.sha256 >/dev/null'"; then
    create_snapshot rehearsal
    transfer_snapshot rehearsal
  fi
  remote "$old_remote" sudo -n install -m 0600 -o root -g root \
    /tmp/clideck-migration-rehearsal/source-artifacts.sha256 \
    /var/backups/clideck-mcp/host-migration-rehearsal-source-artifacts.sha256
  remote "$new_remote" sudo -n bash -s <<'REMOTE'
set -Eeuo pipefail
snapshot=/var/backups/clideck-mcp/host-migration/rehearsal
restore_dump=/tmp/clideck-mcp-rehearsal.dump
install -m 0600 -o postgres -g postgres "$snapshot/database.dump" "$restore_dump"
sudo -u postgres dropdb --if-exists clideck_mcp_rehearsal
sudo -u postgres createdb clideck_mcp_rehearsal
sudo -u postgres pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname=clideck_mcp_rehearsal "$restore_dump"
sudo -u postgres psql -P pager=off -d clideck_mcp_rehearsal -At <<'SQL' \
  > /tmp/clideck-mcp-rehearsal-row-counts.txt
SELECT 'active_knowledge_state|' || count(*) FROM active_knowledge_state
UNION ALL SELECT 'agent_runs|' || count(*) FROM agent_runs
UNION ALL SELECT 'knowledge_items|' || count(*) FROM knowledge_items
UNION ALL SELECT 'knowledge_revisions|' || count(*) FROM knowledge_revisions
UNION ALL SELECT 'pipeline_tasks|' || count(*) FROM pipeline_tasks
UNION ALL SELECT 'source_artifacts|' || count(*) FROM source_artifacts
UNION ALL SELECT 'source_candidates|' || count(*) FROM source_candidates
ORDER BY 1;
SQL
diff -u "$snapshot/row-counts.txt" /tmp/clideck-mcp-rehearsal-row-counts.txt
rm -f "$restore_dump" /tmp/clideck-mcp-rehearsal-row-counts.txt
tar -C / -xzf "$snapshot/state.tar.gz" \
  var/lib/clideck-mcp/source-artifacts
chown -R clideck_mcp_worker:clideck_mcp \
  /var/lib/clideck-mcp/source-artifacts
chmod 0750 /var/lib/clideck-mcp/source-artifacts
REMOTE
  checkpoint rehearsal
  printf 'Rehearsal snapshot restored successfully.\n'
}

cutover() {
  require_checkpoint rehearsal
  [[ "${CLIDECK_MCP_CONFIRM_CUTOVER:-}" == 'YES' ]] || {
    printf 'Set CLIDECK_MCP_CONFIRM_CUTOVER=YES for the production cutover.\n' >&2
    exit 1
  }
  trap 'cutover_failed $?' ERR
  install -d -m 0700 "$state_root"
  remote "$old_remote" sudo -n bash -s <<'REMOTE' \
    > "$state_root/original-pipeline-state.json"
set -Eeuo pipefail
set -a
source /etc/clideck-mcp/migrator.env
set +a
psql "$DATABASE_URL" -At --set=ON_ERROR_STOP=1 -c \
  "SELECT json_build_object(
    'enabled', enabled,
    'paused_reason', paused_reason,
    'max_concurrent_ai_runs', max_concurrent_ai_runs,
    'max_deep_review_runs', max_deep_review_runs
  )::text FROM pipeline_settings WHERE singleton"
REMOTE
  remote "$old_remote" sudo -n bash -s <<'REMOTE'
set -Eeuo pipefail
set -a
source /etc/clideck-mcp/migrator.env
set +a
psql "$DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
UPDATE pipeline_settings
SET enabled = false,
    paused_reason = 'Production host migration in progress',
    pause_requested_at = now(),
    control_generation = control_generation + 1,
    updated_at = now(),
    updated_by = 'migrate-production-host'
WHERE singleton;
SQL
for attempt in {1..180}; do
  active="$(psql "$DATABASE_URL" -At --set=ON_ERROR_STOP=1 -c \
    "SELECT count(*) FROM pipeline_tasks
     WHERE status IN ('claimed','running') AND lease_until > now()")"
  [[ "$active" -eq 0 ]] && break
  sleep 5
done
[[ "$active" -eq 0 ]] || { printf 'Active leases did not drain.\n' >&2; exit 1; }
REMOTE
  pnpm pipeline:pool-stop
  remote "$old_remote" sudo -n systemctl stop \
    cloudflared clideck-mcp-worker clideck-mcp-researcher \
    clideck-mcp-api clideck-mcp-admin clideck-mcp-backup.timer
  create_snapshot final
  transfer_snapshot final
  scp -q "${ssh_options[@]}" "$state_root/original-pipeline-state.json" \
    "$new_remote:/tmp/original-pipeline-state.json"
  remote "$new_remote" sudo -n mv /tmp/original-pipeline-state.json \
    /var/backups/clideck-mcp/host-migration/final/original-pipeline-state.json
  remote "$new_remote" sudo -n bash -s -- "$commit_sha" <<'REMOTE'
set -Eeuo pipefail
commit_sha="$1"
snapshot=/var/backups/clideck-mcp/host-migration/final
restore_dump=/tmp/clideck-mcp-final.dump
restore_roles=/tmp/clideck-mcp-final-roles.sql
systemctl stop \
  cloudflared caddy clideck-mcp-worker clideck-mcp-researcher \
  clideck-mcp-api clideck-mcp-admin 2>/dev/null || true
tar -C / -xzf "$snapshot/state.tar.gz"
tar -C / -xzf "$snapshot/source-artifacts-delta.tar.gz"
chown -R root:root /etc/clideck-mcp /etc/cloudflared
chmod 0700 /etc/clideck-mcp /etc/cloudflared
find /etc/clideck-mcp -maxdepth 1 -type f -exec chmod 0600 {} +
chmod 0600 /etc/cloudflared/token
chown -R clideck_mcp_worker:clideck_mcp \
  /var/lib/clideck-mcp/source-artifacts
chmod 0750 /var/lib/clideck-mcp/source-artifacts
chown -R caddy:caddy /var/lib/caddy
sed -i 's/^RESEARCHER_HOST=.*/RESEARCHER_HOST=127.0.0.1/' \
  /etc/clideck-mcp/researcher.env
for environment_file in \
  /etc/clideck-mcp/api.env /etc/clideck-mcp/admin-ui.env \
  /etc/clideck-mcp/worker.env /etc/clideck-mcp/researcher.env; do
  sed -i "s/^DEPLOY_COMMIT_SHA=.*/DEPLOY_COMMIT_SHA=$commit_sha/" \
    "$environment_file"
done
sudo -u postgres dropdb --if-exists clideck_mcp_rehearsal
sudo -u postgres dropdb --if-exists clideck_mcp
for role_name in \
  clideck_mcp_api clideck_mcp_admin clideck_mcp_worker \
  clideck_mcp_researcher clideck_mcp_quarantine clideck_mcp_backup \
  clideck_mcp_migrator; do
  sudo -u postgres psql --set=ON_ERROR_STOP=1 -c \
    "DROP ROLE IF EXISTS $role_name"
done
install -m 0600 -o postgres -g postgres "$snapshot/database.dump" "$restore_dump"
install -m 0600 -o postgres -g postgres "$snapshot/roles.sql" "$restore_roles"
sudo -u postgres psql --set=ON_ERROR_STOP=1 -f "$restore_roles"
sudo -u postgres createdb --owner=clideck_mcp_migrator clideck_mcp
sudo -u postgres pg_restore --exit-on-error --no-owner --no-privileges \
  --role=clideck_mcp_migrator --dbname=clideck_mcp "$restore_dump"
(
  cd "/opt/clideck-mcp/releases/$commit_sha"
  set -a
  source /etc/clideck-mcp/migrator.env
  set +a
  /usr/local/bin/node dist/cli/migrate.js
)
sudo -u postgres psql --dbname=clideck_mcp --set=ON_ERROR_STOP=1 \
  < "/opt/clideck-mcp/releases/$commit_sha/ops/sql/grants.sql"
sudo -u postgres psql -P pager=off -d clideck_mcp -At <<'SQL' \
  > /tmp/clideck-mcp-final-baseline.txt
SELECT 'active_release|' || to_jsonb(t)::text FROM active_release t;
SELECT 'pipeline_settings|' || to_jsonb(t)::text FROM pipeline_settings t;
SQL
diff -u "$snapshot/baseline.txt" /tmp/clideck-mcp-final-baseline.txt
sudo -u postgres psql -P pager=off -d clideck_mcp -At <<'SQL' \
  > /tmp/clideck-mcp-final-row-counts.txt
SELECT 'active_knowledge_state|' || count(*) FROM active_knowledge_state
UNION ALL SELECT 'agent_runs|' || count(*) FROM agent_runs
UNION ALL SELECT 'knowledge_items|' || count(*) FROM knowledge_items
UNION ALL SELECT 'knowledge_revisions|' || count(*) FROM knowledge_revisions
UNION ALL SELECT 'pipeline_tasks|' || count(*) FROM pipeline_tasks
UNION ALL SELECT 'source_artifacts|' || count(*) FROM source_artifacts
UNION ALL SELECT 'source_candidates|' || count(*) FROM source_candidates
ORDER BY 1;
SQL
diff -u "$snapshot/row-counts.txt" /tmp/clideck-mcp-final-row-counts.txt
rm -f /tmp/clideck-mcp-final-baseline.txt /tmp/clideck-mcp-final-row-counts.txt
(
  cd /
  sha256sum -c "$snapshot/source-artifacts.sha256" >/dev/null
)
rm -f "$restore_dump" "$restore_roles"
install -d -m 0700 -o clideck_mcp_backup -g clideck_mcp \
  /var/backups/clideck-mcp
systemctl daemon-reload
systemctl enable \
  clideck-mcp-api clideck-mcp-admin clideck-mcp-worker \
  clideck-mcp-researcher caddy cloudflared clideck-mcp-backup.timer
systemctl start caddy clideck-mcp-api clideck-mcp-admin \
  clideck-mcp-researcher clideck-mcp-worker
for attempt in {1..30}; do
  curl -fsS http://127.0.0.1:8787/ready >/dev/null &&
    curl -fsS http://127.0.0.1:8790/admin/health >/dev/null && break
  sleep 1
done
curl -fsS http://127.0.0.1:8787/ready >/dev/null
curl -fsS http://127.0.0.1:8790/admin/health >/dev/null
REMOTE
  replace_env_value .secrets/researcher-bridge.env \
    CLIDECK_RESEARCHER_SSH_HOST "$new_host"
  replace_env_value .secrets/clideck-mcp-server.env CLIDECK_MCP_HOST "$new_host"
  pnpm pipeline:install-launchd
  pnpm pipeline:pool-stop
  remote "$new_remote" sudo -n systemctl start cloudflared
  checkpoint cutover
  trap - ERR
  printf 'Application cut over with the pipeline still paused. Run verify next.\n'
}

verify() {
  require_checkpoint cutover
  remote "$new_remote" sudo -n systemctl is-active --quiet \
    postgresql caddy cloudflared clideck-mcp-api clideck-mcp-admin \
    clideck-mcp-worker clideck-mcp-researcher
  remote "$new_remote" sudo -n bash -s <<'REMOTE'
set -Eeuo pipefail
systemctl start clideck-mcp-backup.timer
latest_dump="$(find /var/backups/clideck-mcp -maxdepth 1 -type f \
  -name 'clideck-mcp-*.dump' -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
if [[ -z "$latest_dump" || ! -f "$latest_dump.sha256" ]] ||
   ! sha256sum -c "$latest_dump.sha256" >/dev/null 2>&1; then
  systemctl start clideck-mcp-backup.service
  latest_dump="$(find /var/backups/clideck-mcp -maxdepth 1 -type f \
    -name 'clideck-mcp-*.dump' -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
fi
sha256sum -c "$latest_dump.sha256"
restore_test_dump=/tmp/clideck-mcp-backup-restore-test.dump
install -m 0600 -o postgres -g postgres "$latest_dump" "$restore_test_dump"
sudo -u postgres dropdb --if-exists clideck_mcp_restore_test
sudo -u postgres createdb clideck_mcp_restore_test
sudo -u postgres pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname=clideck_mcp_restore_test "$restore_test_dump"
sudo -u postgres psql -d clideck_mcp_restore_test -Atc \
  'SELECT count(*) FROM active_knowledge_state;'
sudo -u postgres dropdb clideck_mcp_restore_test
rm -f "$restore_test_dump"
CLIDECK_MCP_BASE_URL=http://127.0.0.1:8787 \
  /opt/clideck-mcp/current/ops/scripts/smoke-test.sh
REMOTE
  curl --fail --silent --show-error https://mcp.clideck.com/health >/dev/null
  curl --fail --silent --show-error https://mcp.clideck.com/ready >/dev/null
  admin_ca="$(mktemp)"
  trap 'rm -f "$admin_ca"' EXIT
  remote "$new_remote" sudo -n cat \
    /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt \
    > "$admin_ca"
  chmod 0600 "$admin_ca"
  curl --fail --silent --show-error \
    --cacert "$admin_ca" \
    --resolve "clideck-mcp.lan:443:$new_host" \
    https://clideck-mcp.lan/admin/health >/dev/null
  rm -f "$admin_ca"
  trap - EXIT
  remote "$new_remote" sudo -n bash -s <<'REMOTE'
set -Eeuo pipefail
snapshot=/var/backups/clideck-mcp/host-migration/final
set -a
source /etc/clideck-mcp/migrator.env
set +a
psql "$DATABASE_URL" --set=ON_ERROR_STOP=1 \
  --set=migration_pipeline_state="$(cat "$snapshot/original-pipeline-state.json")" <<'SQL'
UPDATE pipeline_settings
SET enabled = (:'migration_pipeline_state'::jsonb ->> 'enabled')::boolean,
    paused_reason = nullif(
      :'migration_pipeline_state'::jsonb ->> 'paused_reason',
      ''
    ),
    pause_requested_at = NULL,
    max_concurrent_ai_runs =
      (:'migration_pipeline_state'::jsonb ->> 'max_concurrent_ai_runs')::smallint,
    max_deep_review_runs =
      (:'migration_pipeline_state'::jsonb ->> 'max_deep_review_runs')::smallint,
    control_generation = control_generation + 1,
    updated_at = now(),
    updated_by = 'migrate-production-host'
WHERE singleton;
SQL
REMOTE
  pnpm pipeline:pool-start
  pnpm pipeline:pool-status >/dev/null
  checkpoint verify
  printf 'Production host migration verified; begin the two-hour soak.\n'
}

rollback() {
  require_checkpoint cutover
  [[ "${CLIDECK_MCP_CONFIRM_ROLLBACK:-}" == 'YES' ]] || {
    printf 'Set CLIDECK_MCP_CONFIRM_ROLLBACK=YES only before new writes resume.\n' >&2
    exit 1
  }
  return_to_rollback_host
  checkpoint rollback
  printf 'Traffic and local executor tunnel returned to the rollback host.\n'
}

case "$phase" in
  preflight) preflight ;;
  prepare) prepare ;;
  rehearsal) rehearsal ;;
  cutover) cutover ;;
  verify) verify ;;
  rollback) rollback ;;
  *) usage; exit 2 ;;
esac
