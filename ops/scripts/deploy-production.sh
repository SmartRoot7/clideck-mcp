#!/usr/bin/env bash
set -Eeuo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

secrets_file="${CLIDECK_MCP_DEPLOY_SECRETS_FILE:-.secrets/clideck-mcp-server.env}"
if [[ -f "$secrets_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$secrets_file"
  set +a
fi

: "${CLIDECK_MCP_HOST:?CLIDECK_MCP_HOST is required}"
: "${CLIDECK_MCP_USER:?CLIDECK_MCP_USER is required}"

for command_name in git pnpm ssh scp curl createdb dropdb; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 1
  fi
done

if [[ "$(git branch --show-current)" != 'main' ]]; then
  printf 'Production deployment is allowed only from main\n' >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  printf 'Commit or discard local changes before production deployment\n' >&2
  exit 1
fi

commit_sha="$(git rev-parse HEAD)"
short_sha="${commit_sha:0:12}"
remote_host="$CLIDECK_MCP_USER@$CLIDECK_MCP_HOST"
temporary_directory="$(mktemp -d)"
test_database="clideck_mcp_deploy_${short_sha}_$$"
test_database_created=0
pipeline_pool_was_running=0
pipeline_pool_stopped=0
pipeline_pool_restarted=0

cleanup() {
  status=$?
  trap - EXIT INT TERM
  set +e
  # The Luna coordinators are long-lived TypeScript processes.  A production
  # checkout switch alone cannot update code already loaded in their memory.
  # If deployment fails after the pool was stopped, restore the prior local
  # service so an unsuccessful release cannot leave the pipeline stranded.
  if [[ "$pipeline_pool_was_running" -eq 1 && \
        "$pipeline_pool_stopped" -eq 1 && \
        "$pipeline_pool_restarted" -eq 0 ]]; then
    pnpm pipeline:pool-start >/dev/null 2>&1 || true
  fi
  if [[ "$test_database_created" -eq 1 ]]; then
    dropdb --if-exists "$test_database" >/dev/null 2>&1
  fi
  rm -rf "$temporary_directory"
  exit "$status"
}
trap cleanup EXIT INT TERM

printf '==> Preflight %s\n' "$commit_sha"
pnpm check

createdb "$test_database"
test_database_created=1
test_database_url="postgresql:///$test_database"
DATABASE_URL="$test_database_url" \
  QUARANTINE_DATABASE_URL="$test_database_url" \
  pnpm db:migrate
DATABASE_URL="$test_database_url" \
  QUARANTINE_DATABASE_URL="$test_database_url" \
  pnpm db:seed
DATABASE_URL="$test_database_url" \
  QUARANTINE_DATABASE_URL="$test_database_url" \
  pnpm test
DATABASE_URL="$test_database_url" \
  QUARANTINE_DATABASE_URL="$test_database_url" \
  pnpm eval
pnpm build

archive_path="$temporary_directory/clideck-mcp-$commit_sha.tar.gz"
git archive --format=tar.gz --output="$archive_path" "$commit_sha"

printf '==> Build Linux release candidate\n'
scp -q "$archive_path" \
  "$remote_host:/tmp/clideck-mcp-$commit_sha.tar.gz"
ssh -o ConnectTimeout=10 "$remote_host" bash -s -- "$commit_sha" <<'REMOTE_BUILD'
set -Eeuo pipefail
commit_sha="$1"
candidate_directory="/tmp/clideck-mcp-build-$commit_sha"
release_directory="/opt/clideck-mcp/releases/$commit_sha"
store_directory="/tmp/clideck-mcp-pnpm-store-$commit_sha"
build_log="/tmp/clideck-mcp-build-$commit_sha.log"

cleanup_remote_build() {
  status=$?
  trap - EXIT
  rm -rf "$store_directory"
  rm -f "$build_log"
  rm -f "/tmp/clideck-mcp-$commit_sha.tar.gz"
  if [[ "$status" -ne 0 ]]; then
    rm -rf "$candidate_directory"
  fi
  exit "$status"
}
trap cleanup_remote_build EXIT

rm -rf "$candidate_directory"
rm -rf "$store_directory"
mkdir -p "$candidate_directory"
mkdir -p "$store_directory"
tar -xzf "/tmp/clideck-mcp-$commit_sha.tar.gz" -C "$candidate_directory"
cd "$candidate_directory"
if ! CI=true pnpm install \
  --frozen-lockfile \
  --store-dir "$store_directory" \
  --package-import-method=copy >"$build_log" 2>&1; then
  printf 'Remote dependency install failed; last 120 lines follow.\n' >&2
  tail -n 120 "$build_log" >&2
  exit 1
fi
if ! CI=true pnpm build >>"$build_log" 2>&1; then
  printf 'Remote production build failed; last 120 lines follow.\n' >&2
  tail -n 120 "$build_log" >&2
  exit 1
fi
REMOTE_BUILD

printf '==> Backup, atomic switch, smoke test, rollback on failure\n'
# Stop the local Luna pool only after every local and remote build gate has
# passed.  The remote rollout pauses the database pipeline and waits for its
# leases; stopping here guarantees that no executor can submit an artifact
# produced by an older in-memory coordinator after the release is switched.
if pnpm pipeline:pool-status >/dev/null 2>&1; then
  pipeline_pool_was_running=1
  printf '==> Stop local Luna pool before checkout switch\n'
  pnpm pipeline:pool-stop
  pipeline_pool_stopped=1
fi

if [[ -n "${CLIDECK_MCP_PASSWORD:-}" ]]; then
  ssh -o ConnectTimeout=10 "$remote_host" \
    "if test -f /tmp/clideck-mcp-build-$commit_sha/ops/scripts/deploy-production-remote.sh; then sudo -S -p '' /bin/bash /tmp/clideck-mcp-build-$commit_sha/ops/scripts/deploy-production-remote.sh '$commit_sha' '/tmp/clideck-mcp-build-$commit_sha'; else sudo -S -p '' /bin/bash /opt/clideck-mcp/releases/$commit_sha/ops/scripts/deploy-production-remote.sh '$commit_sha' '/tmp/clideck-mcp-build-$commit_sha'; fi" \
    <<< "$CLIDECK_MCP_PASSWORD"
else
  ssh -o ConnectTimeout=10 "$remote_host" \
    "if test -f /tmp/clideck-mcp-build-$commit_sha/ops/scripts/deploy-production-remote.sh; then sudo -n /bin/bash /tmp/clideck-mcp-build-$commit_sha/ops/scripts/deploy-production-remote.sh '$commit_sha' '/tmp/clideck-mcp-build-$commit_sha'; else sudo -n /bin/bash /opt/clideck-mcp/releases/$commit_sha/ops/scripts/deploy-production-remote.sh '$commit_sha' '/tmp/clideck-mcp-build-$commit_sha'; fi"
fi

if [[ "$pipeline_pool_was_running" -eq 1 ]]; then
  printf '==> Start local Luna pool on %s\n' "$commit_sha"
  pnpm pipeline:pool-start
  pipeline_pool_restarted=1
  pnpm pipeline:pool-status >/dev/null
fi

curl --fail --silent --show-error https://mcp.clideck.com/health >/dev/null
curl --fail --silent --show-error https://mcp.clideck.com/ready >/dev/null

printf 'Production deployment verified: %s\n' "$commit_sha"
