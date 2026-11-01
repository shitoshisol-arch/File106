#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 host for the FILE106 archive stack: packages,
# swap, the host firewall, Docker. Works on any provider — Google Cloud, Hetzner,
# Lightsail, Oracle, a box under your desk.
#
#   git clone <repo> /opt/file106 && cd /opt/file106
#   sudo bash scripts/archive/bootstrap-vps.sh
#
# Idempotent: safe to run twice. It never touches application data, never writes
# .env, and never touches anything on-chain.

set -euo pipefail

log() { printf '\n==> %s\n' "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash scripts/archive/bootstrap-vps.sh" >&2
  exit 1
fi

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    echo "warning: expected Ubuntu, found ${ID:-unknown}; continuing anyway" >&2
  elif [[ "${VERSION_ID:-}" != 24.04* ]]; then
    echo "warning: expected Ubuntu 24.04, found ${VERSION_ID:-unknown}; continuing anyway" >&2
  fi
fi

export DEBIAN_FRONTEND=noninteractive

log "installing base packages"
apt-get update -qq
apt-get -y -qq upgrade
apt-get -y -qq install ca-certificates curl git

# iptables-persistent asks questions on install; answer them in advance.
echo 'iptables-persistent iptables-persistent/autosave_v4 boolean true' | debconf-set-selections
echo 'iptables-persistent iptables-persistent/autosave_v6 boolean true' | debconf-set-selections
apt-get -y -qq install iptables-persistent

log "configuring swap (2 GB, skipped when already present)"
if ! swapon --show | grep -q '/swapfile'; then
  if ! fallocate -l 2G /swapfile 2>/dev/null; then
    dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  fi
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "opening 80 and 443 in the host firewall"
# Providers differ here. Oracle's images ship an INPUT chain that drops everything
# but SSH, so the rule must sit *before* the catch-all REJECT — insert by line
# number rather than appending. Most other images have no rules at all, in which
# case appending is correct.
open_port() {
  local port="$1"
  if iptables -C INPUT -p tcp --dport "${port}" -j ACCEPT 2>/dev/null; then
    echo "    port ${port} already open"
    return 0
  fi

  local reject_line
  reject_line="$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')"
  if [[ -n "${reject_line}" ]]; then
    iptables -I INPUT "${reject_line}" -p tcp --dport "${port}" -j ACCEPT
  else
    iptables -A INPUT -p tcp --dport "${port}" -j ACCEPT
  fi
  echo "    port ${port} opened"
}

open_port 80
open_port 443
netfilter-persistent save >/dev/null

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow 80,443/tcp
  echo "    ufw rules updated"
fi

log "installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
if [[ -n "${SUDO_USER:-}" ]]; then
  usermod -aG docker "${SUDO_USER}"
  echo "    added ${SUDO_USER} to the docker group (log out and back in to use it)"
fi

log "checking reachability of the ports from the host itself"
for port in 80 443; do
  if iptables -C INPUT -p tcp --dport "${port}" -j ACCEPT 2>/dev/null; then
    echo "    ${port}: host firewall open"
  else
    echo "    ${port}: NOT open — check the rules above" >&2
  fi
done

cat <<'EOF'

  Host prepared. Still required, and not scriptable from here:

    1. Open 80 and 443 in the provider's firewall. That is a separate layer from
       the host rules just set:

         Google Cloud  VPC network -> Firewall -> ingress 0.0.0.0/0 tcp:80, tcp:443
         Hetzner       Firewalls -> allow tcp 80 and 443
         Lightsail     Networking -> add HTTP and HTTPS rules
         Oracle        VCN -> Security List -> ingress 0.0.0.0/0 TCP 80 and 443

       If both layers are not open, Caddy cannot obtain a certificate and nothing
       loads. Never open 5432.

    2. Reserve a static public IP, then point your DuckDNS subdomain at it. A
       stop/start on an ephemeral address moves the IP out from under your DNS.

  Then, in this directory:

    node scripts/archive/init-env.mjs --domain <name>.duckdns.org \
         --rpc "<helius url>" --smtp "<brevo url>" --mail-from "<verified address>"
    node scripts/archive/preflight.mjs
    docker compose up -d --build
EOF
