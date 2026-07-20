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

cleanup() {
  status=$?
  trap - EXIT INT TERM
  set +e
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

cleanup_remote_build() {
  status=$?
  trap - EXIT
  rm -rf "$store_directory"
  rm -f "/tmp/clideck-mcp-$commit_sha.tar.gz"
  if [[ "$status" -ne 0 ]]; then
    rm -rf "$candidate_directory"
  fi
  exit "$status"
}
trap cleanup_remote_build EXIT

if [[ -d "$release_directory" ]]; then
  exit 0
fi

rm -rf "$candidate_directory"
rm -rf "$store_directory"
mkdir -p "$candidate_directory"
mkdir -p "$store_directory"
tar -xzf "/tmp/clideck-mcp-$commit_sha.tar.gz" -C "$candidate_directory"
cd "$candidate_directory"
CI=true pnpm install \
  --frozen-lockfile \
  --store-dir "$store_directory" \
  --package-import-method=copy
CI=true pnpm build
REMOTE_BUILD

printf '==> Backup, atomic switch, smoke test, rollback on failure\n'
if [[ -n "${CLIDECK_MCP_PASSWORD:-}" ]]; then
  ssh -o ConnectTimeout=10 "$remote_host" \
    "if test -f /tmp/clideck-mcp-build-$commit_sha/ops/scripts/deploy-production-remote.sh; then sudo -S -p '' /bin/bash /tmp/clideck-mcp-build-$commit_sha/ops/scripts/deploy-production-remote.sh '$commit_sha' '/tmp/clideck-mcp-build-$commit_sha'; else sudo -S -p '' /bin/bash /opt/clideck-mcp/releases/$commit_sha/ops/scripts/deploy-production-remote.sh '$commit_sha' '/tmp/clideck-mcp-build-$commit_sha'; fi" \
    <<< "$CLIDECK_MCP_PASSWORD"
else
  ssh -o ConnectTimeout=10 "$remote_host" \
    "if test -f /tmp/clideck-mcp-build-$commit_sha/ops/scripts/deploy-production-remote.sh; then sudo -n /bin/bash /tmp/clideck-mcp-build-$commit_sha/ops/scripts/deploy-production-remote.sh '$commit_sha' '/tmp/clideck-mcp-build-$commit_sha'; else sudo -n /bin/bash /opt/clideck-mcp/releases/$commit_sha/ops/scripts/deploy-production-remote.sh '$commit_sha' '/tmp/clideck-mcp-build-$commit_sha'; fi"
fi

curl --fail --silent --show-error https://mcp.clideck.com/health >/dev/null
curl --fail --silent --show-error https://mcp.clideck.com/ready >/dev/null

printf 'Production deployment verified: %s\n' "$commit_sha"
