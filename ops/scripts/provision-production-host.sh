#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  printf 'provision-production-host.sh must run as root\n' >&2
  exit 1
fi

commit_sha="${1:-}"
candidate_directory="${2:-}"
if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
   [[ -z "$candidate_directory" || ! -d "$candidate_directory" ]]; then
  printf 'Usage: provision-production-host.sh COMMIT_SHA CANDIDATE_DIRECTORY\n' >&2
  exit 1
fi
if [[ "$(. /etc/os-release; printf '%s' "$ID:$VERSION_ID")" != 'ubuntu:24.04' ]]; then
  printf 'Production host must run Ubuntu 24.04\n' >&2
  exit 1
fi
if ! command -v tailscale >/dev/null 2>&1 ||
   ! systemctl is-active --quiet tailscaled; then
  printf 'Tailscale must be installed, connected and active before provisioning\n' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  ca-certificates caddy curl gnupg jq postgresql postgresql-client \
  rsync tar ufw xz-utils

if ! command -v cloudflared >/dev/null 2>&1; then
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg |
    gpg --dearmor --yes -o /usr/share/keyrings/cloudflare-main.gpg
  printf '%s\n' \
    'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update
  apt-get install -y cloudflared
fi

node_version='24.18.0'
node_directory="/opt/node-v${node_version}-linux-x64"
if [[ ! -x "$node_directory/bin/node" ]]; then
  temporary_directory="$(mktemp -d)"
  trap 'rm -rf "$temporary_directory"' EXIT
  archive_name="node-v${node_version}-linux-x64.tar.xz"
  base_url="https://nodejs.org/dist/v${node_version}"
  curl -fsSLo "$temporary_directory/$archive_name" "$base_url/$archive_name"
  curl -fsSLo "$temporary_directory/SHASUMS256.txt" "$base_url/SHASUMS256.txt"
  (
    cd "$temporary_directory"
    grep "  $archive_name\$" SHASUMS256.txt | sha256sum --check --strict
  )
  tar -xJf "$temporary_directory/$archive_name" -C /opt
fi
ln -sfn "$node_directory" /opt/node24
ln -sfn /opt/node24/bin/node /usr/local/bin/node
ln -sfn /opt/node24/bin/npm /usr/local/bin/npm
ln -sfn /opt/node24/bin/npx /usr/local/bin/npx
"$node_directory/bin/npm" install --global pnpm@11.9.0
ln -sfn "$node_directory/bin/pnpm" /usr/local/bin/pnpm

if ! getent group clideck_mcp >/dev/null; then
  addgroup --system clideck_mcp
fi
for service_name in api admin worker researcher backup; do
  user_name="clideck_mcp_${service_name}"
  if ! getent passwd "$user_name" >/dev/null; then
    adduser --system --no-create-home --home /nonexistent \
      --shell /usr/sbin/nologin --ingroup clideck_mcp "$user_name"
  fi
done

install -d -m 0750 -o root -g clideck_mcp /opt/clideck-mcp/releases
install -d -m 0700 -o root -g root /etc/clideck-mcp /etc/cloudflared
install -d -m 0750 -o clideck_mcp_worker -g clideck_mcp \
  /var/lib/clideck-mcp/source-artifacts
install -d -m 0700 -o clideck_mcp_backup -g clideck_mcp \
  /var/backups/clideck-mcp

for unit in "$candidate_directory"/ops/systemd/*.service \
  "$candidate_directory"/ops/systemd/*.timer; do
  install -m 0644 "$unit" "/etc/systemd/system/${unit##*/}"
done
install -m 0644 "$candidate_directory/ops/caddy/Caddyfile" /etc/caddy/Caddyfile
tailscale set --operator=caddy

systemctl daemon-reload
systemctl disable --now cloudflared.service caddy.service 2>/dev/null || true
systemctl stop \
  clideck-mcp-api clideck-mcp-admin clideck-mcp-worker \
  clideck-mcp-researcher clideck-mcp-backup.timer 2>/dev/null || true
systemctl enable \
  clideck-mcp-api clideck-mcp-admin clideck-mcp-worker \
  clideck-mcp-researcher caddy.service

ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0 to any port 22 proto tcp
ufw allow from 10.77.0.0/24 to any port 22 proto tcp
ufw allow in on tailscale0 from 100.117.119.94 to any port 443 proto tcp
ufw --force enable

release_directory="/opt/clideck-mcp/releases/$commit_sha"
if [[ ! -f "$release_directory/dist/entrypoints/api.js" ]]; then
  store_directory="/tmp/clideck-mcp-provision-store-$commit_sha"
  rm -rf "$store_directory"
  (
    cd "$candidate_directory"
    CI=true pnpm install --frozen-lockfile \
      --store-dir "$store_directory" --package-import-method=copy
    CI=true pnpm build
  )
  rm -rf "$store_directory"
  mv "$candidate_directory" "$release_directory"
  chown -R root:clideck_mcp "$release_directory"
  chmod -R g+rwX,o-rwx "$release_directory"
fi
ln -sfn "$release_directory" /opt/clideck-mcp/current

printf 'Prepared production host with release %s; application services remain stopped.\n' \
  "$commit_sha"
