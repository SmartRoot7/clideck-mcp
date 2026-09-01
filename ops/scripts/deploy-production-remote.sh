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
release_retention_count="${CLIDECK_MCP_RELEASE_RETENTION_COUNT:-8}"
backup_retention_count="${CLIDECK_MCP_BACKUP_RETENTION_COUNT:-14}"
caddy_config="${CLIDECK_MCP_CADDY_CONFIG:-/etc/caddy/Caddyfile}"
admin_tailscale_origin="${CLIDECK_MCP_ADMIN_TAILSCALE_ORIGIN:-https://clideck-mcp.taild43e46.ts.net}"

if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'A full 40-character Git commit SHA is required\n' >&2
  exit 1
fi
if [[ ! "$release_retention_count" =~ ^[1-9][0-9]*$ ]] ||
   [[ ! "$backup_retention_count" =~ ^[1-9][0-9]*$ ]]; then
  printf 'Deployment retention counts must be positive integers\n' >&2
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
cp -a "$caddy_config" "$backup_directory/Caddyfile"

set -a
# shellcheck disable=SC1091
source "$config_directory/backup.env"
set +a
BACKUP_DIRECTORY="$backup_directory" \
  BACKUP_RETENTION_DAYS=36500 \
  "$previous_release/ops/scripts/backup.sh"
tar -C /etc -czf "$backup_directory/etc-clideck-mcp.tar.gz" clideck-mcp

switched=0
config_updated=0
pipeline_state_captured=0
pipeline_state_json=''
previous_active_release=''
tailscale_operator_before=''
tailscale_operator_updated=0

restore_pipeline_state() {
  if [[ "$pipeline_state_captured" -ne 1 ]]; then
    return
  fi
  psql "$DATABASE_URL" \
    --set=ON_ERROR_STOP=1 \
    --set=deployment_pipeline_state="$pipeline_state_json" <<'SQL'
UPDATE pipeline_settings
SET enabled =
      (:'deployment_pipeline_state'::jsonb ->> 'enabled')::boolean,
    paused_reason = nullif(
      :'deployment_pipeline_state'::jsonb ->> 'paused_reason',
      ''
    ),
    pause_requested_at = CASE
      WHEN (:'deployment_pipeline_state'::jsonb ->> 'enabled')::boolean
        THEN NULL
      ELSE pause_requested_at
    END,
    control_generation = control_generation + 1,
    updated_at = now(),
    updated_by = 'deploy-production'
WHERE singleton;
SQL
}

rollback_on_error() {
  status=$?
  trap - ERR
  set +e
  if [[ -n "$previous_active_release" &&
        -f "$release_directory/dist/cli/activate-release.js" ]]; then
    (
      cd "$release_directory"
      /usr/local/bin/node dist/cli/activate-release.js \
        "$previous_active_release"
    )
  fi
  if [[ "$config_updated" -eq 1 ]]; then
    cp -a "$backup_directory/api.env" "$config_directory/api.env"
    cp -a "$backup_directory/admin-ui.env" "$config_directory/admin-ui.env"
    cp -a "$backup_directory/worker.env" "$config_directory/worker.env"
    cp -a "$backup_directory/researcher.env" "$config_directory/researcher.env"
    cp -a "$backup_directory/Caddyfile" "$caddy_config"
    caddy validate --adapter caddyfile --config "$caddy_config" >/dev/null 2>&1
    systemctl reload caddy || systemctl restart caddy
  fi
  if [[ "$tailscale_operator_updated" -eq 1 ]]; then
    tailscale set --operator="$tailscale_operator_before"
  fi
  if [[ "$switched" -eq 1 ]]; then
    temporary_link="${current_link}.rollback.$$"
    ln -s "$previous_release" "$temporary_link"
    mv -Tf "$temporary_link" "$current_link"
    systemctl restart \
      clideck-mcp-researcher \
      clideck-mcp-worker \
      clideck-mcp-api \
      clideck-mcp-admin
  fi
  restore_pipeline_state
  printf 'Deployment failed; production was %s\n' \
    "$([[ "$switched" -eq 1 ]] && printf 'rolled back' || printf 'not switched')" \
    >&2
  exit "$status"
}
trap rollback_on_error ERR

required_release_paths=(
  dist/entrypoints/api.js \
  dist/entrypoints/admin.js \
  dist/entrypoints/worker.js \
  dist/entrypoints/researcher.js \
  dist/cli/migrate.js \
  dist/cli/seed.js \
  dist/cli/reconcile-074.js \
  dist/cli/reconcile-processing-runs.js \
  dist/cli/refresh-public-stats.js \
  dist/cli/reindex-applicability.js \
  dist/cli/repair-portable-risk.js \
  dist/cli/activate-release.js \
  dist-admin/index.html \
  ops/caddy/Caddyfile \
  ops/sql/grants.sql \
  ops/scripts/smoke-test.sh
)

release_is_complete() {
  local path
  for path in "${required_release_paths[@]}"; do
    if [[ ! -e "$release_directory/$path" ]]; then
      return 1
    fi
  done
  return 0
}

if [[ -d "$release_directory" ]] && ! release_is_complete; then
  incomplete_directory="${release_directory}.incomplete-${timestamp}-$$"
  printf 'Preserving incomplete release as %s\n' "$incomplete_directory" >&2
  mv "$release_directory" "$incomplete_directory"
fi

if [[ ! -d "$release_directory" ]]; then
  if [[ -z "$candidate_directory" || ! -d "$candidate_directory" ]]; then
    printf 'Built candidate directory is required for a new release\n' >&2
    exit 1
  fi
  mv "$candidate_directory" "$release_directory"
  chown -R root:clideck_mcp "$release_directory"
  chmod -R g+rwX,o-rwx "$release_directory"
fi

if ! release_is_complete; then
  printf 'Release artifact is incomplete after installation\n' >&2
  exit 1
fi

caddy validate --adapter caddyfile \
  --config "$release_directory/ops/caddy/Caddyfile" >/dev/null
tailscale_operator_before="$(
  tailscale debug prefs | jq -r '.OperatorUser // empty'
)"
printf '%s\n' "$tailscale_operator_before" \
  > "$backup_directory/tailscale-operator.txt"

# The build phase always creates a fresh candidate.  When this exact SHA was
# already deployed successfully, keep the verified release and discard only
# that temporary, SHA-addressed candidate directory.
if [[ -n "$candidate_directory" && -d "$candidate_directory" ]]; then
  rm -rf "$candidate_directory"
fi

set -a
# shellcheck disable=SC1091
source "$config_directory/migrator.env"
set +a

pipeline_state_json="$(
  psql "$DATABASE_URL" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="SELECT json_build_object(
      'enabled', enabled,
      'paused_reason', paused_reason
    )::text FROM pipeline_settings WHERE singleton"
)"
previous_active_release="$(
  psql "$DATABASE_URL" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="SELECT release_id::text FROM active_release WHERE singleton"
)"
pipeline_state_captured=1
printf '%s\n' "$pipeline_state_json" > "$backup_directory/pipeline-state.json"
printf '%s\n' "$previous_active_release" \
  > "$backup_directory/previous-active-release.txt"

# Admin Intake and the worker share immutable source storage through their
# common clideck_mcp group. The setgid bit keeps newly staged directories
# writable by the worker after admin handoff.
install -d -m 2770 -o clideck_mcp_worker -g clideck_mcp \
  /var/lib/clideck-mcp/source-artifacts

psql "$DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
UPDATE pipeline_settings
SET enabled = false,
    paused_reason = 'Production deployment in progress',
    pause_requested_at = now(),
    control_generation = control_generation + 1,
    updated_at = now(),
    updated_by = 'deploy-production'
WHERE singleton;
SQL

for _attempt in {1..20}; do
  active_ai="$(
    psql "$DATABASE_URL" --tuples-only --no-align --set=ON_ERROR_STOP=1 \
      --command="SELECT count(*) FROM pipeline_tasks
        WHERE task_type IN (
          'expert_research',
          'candidate_deep_review',
          'candidate_verification',
          'fragment_analysis',
          'source_discovery'
        )
        AND status IN ('claimed', 'running')
        AND lease_until > now()"
  )"
  if [[ "$active_ai" -eq 0 ]]; then
    break
  fi
  sleep 1
done
if [[ "$active_ai" -ne 0 ]]; then
  printf 'Timed out waiting for %s active Luna lease(s)\n' "$active_ai" >&2
  exit 1
fi

(
  cd "$release_directory"
  /usr/local/bin/node dist/cli/migrate.js
)
sudo -u postgres psql \
  --dbname=clideck_mcp \
  --set=ON_ERROR_STOP=1 \
  < "$release_directory/ops/sql/grants.sql"

(
  cd "$release_directory"
  /usr/local/bin/node dist/cli/reconcile-074.js
  /usr/local/bin/node dist/cli/reconcile-processing-runs.js
  /usr/local/bin/node dist/cli/seed.js
  /usr/local/bin/node dist/cli/reindex-applicability.js --dry-run
  /usr/local/bin/node dist/cli/reindex-applicability.js --resume --verify
  /usr/local/bin/node dist/cli/repair-portable-risk.js
  /usr/local/bin/node dist/cli/refresh-public-stats.js
)

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

ensure_csv_env_value() {
  environment_file="$1"
  key="$2"
  required_value="$3"
  current_value="$(sed -n "s/^$key=//p" "$environment_file" | tail -n 1)"
  case ",$current_value," in
    *",$required_value,"*) return ;;
  esac
  if [[ -n "$current_value" ]]; then
    updated_value="$current_value,$required_value"
  else
    updated_value="$required_value"
  fi
  temporary_file="$(mktemp "$config_directory/.admin-ui.env.XXXXXX")"
  awk -v key="$key" -v value="$updated_value" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 { print key "=" value; replaced = 1; next }
    { print }
    END { if (!replaced) print key "=" value }
  ' "$environment_file" > "$temporary_file"
  chown --reference="$environment_file" "$temporary_file"
  chmod --reference="$environment_file" "$temporary_file"
  mv "$temporary_file" "$environment_file"
}

config_updated=1
if [[ "$tailscale_operator_before" != 'caddy' ]]; then
  tailscale set --operator=caddy
  tailscale_operator_updated=1
fi
set_deployed_sha "$config_directory/api.env"
set_deployed_sha "$config_directory/admin-ui.env"
set_deployed_sha "$config_directory/worker.env"
set_deployed_sha "$config_directory/researcher.env"
ensure_csv_env_value "$config_directory/admin-ui.env" \
  ADMIN_UI_ALLOWED_ORIGINS "$admin_tailscale_origin"
install -m 0644 -o root -g root \
  "$release_directory/ops/caddy/Caddyfile" "$caddy_config"

temporary_link="${current_link}.next.$$"
ln -s "$release_directory" "$temporary_link"
mv -Tf "$temporary_link" "$current_link"
switched=1

systemctl restart \
  clideck-mcp-researcher \
  clideck-mcp-worker \
  clideck-mcp-api \
  clideck-mcp-admin
systemctl reload caddy

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

admin_tailscale_host="${admin_tailscale_origin#https://}"
curl --fail --silent --show-error \
  --resolve "$admin_tailscale_host:443:127.0.0.1" \
  "$admin_tailscale_origin/admin/health" >/dev/null

CLIDECK_MCP_BASE_URL=http://127.0.0.1:8787 \
  "$release_directory/ops/scripts/smoke-test.sh"

restore_pipeline_state

if [[ "$(readlink -f "$current_link")" != "$release_directory" ]]; then
  printf 'Atomic release switch did not persist\n' >&2
  exit 1
fi

prune_deployment_history() {
  local current_release previous_keep entry entry_name index
  local -a release_entries backup_entries
  current_release="$(readlink -f "$current_link")"
  previous_keep="$previous_release"

  mapfile -t release_entries < <(
    find "$release_root" -mindepth 1 -maxdepth 1 -type d \
      -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-
  )
  index=0
  for entry in "${release_entries[@]}"; do
    entry_name="${entry##*/}"
    [[ "$entry_name" =~ ^[0-9a-f]{40}$ ]] || continue
    if [[ "$entry" == "$current_release" || "$entry" == "$previous_keep" ]]; then
      continue
    fi
    index=$((index + 1))
    if (( index > release_retention_count )); then
      rm -rf -- "$entry"
    fi
  done

  mapfile -t backup_entries < <(
    find "$backup_root" -mindepth 1 -maxdepth 1 -type d \
      -name 'deploy-*' -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-
  )
  index=0
  for entry in "${backup_entries[@]}"; do
    entry_name="${entry##*/}"
    [[ "$entry_name" =~ ^deploy-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7}$ ]] || continue
    index=$((index + 1))
    if (( index > backup_retention_count )) && [[ "$entry" != "$backup_directory" ]]; then
      rm -rf -- "$entry"
    fi
  done
}

# Retention runs only after migration, service restart, smoke, pipeline-state
# restoration and atomic-link verification have all succeeded. Housekeeping
# failure is reported but must not roll back an otherwise healthy release.
if ! prune_deployment_history; then
  printf 'Warning: deployment history retention did not complete\n' >&2
fi

switched=0
trap - ERR
printf 'DEPLOYED_SHA=%s\n' "$commit_sha"
printf 'PREVIOUS_RELEASE=%s\n' "$previous_release"
printf 'BACKUP_DIRECTORY=%s\n' "$backup_directory"
