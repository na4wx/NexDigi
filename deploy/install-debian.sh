#!/usr/bin/env bash
# Safe installer for NexDigi on Debian-like systems
# - Verifies Node.js is present and minimum version
# - Stops existing systemd service if present
# - Backs up previous installation to /opt/nexdigi.bak.TIMESTAMP
# - Copies new files to /opt/nexdigi
# - Installs production npm deps as the deploy user
# - Installs/updates systemd unit and restarts service

set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
INSTALL_DIR=/opt/nexdigi
SERVICE_NAME=nexdigi
NODE_MIN_MAJOR=18

print() { echo "[nexdigi-installer] $*"; }
err() { echo "[nexdigi-installer][ERROR] $*" >&2; exit 1; }

# Check for root
if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (use sudo)"
fi

# Check Node
if ! command -v node >/dev/null 2>&1; then
  err "Node.js not found. Install Node ${NODE_MIN_MAJOR}+ before running this script."
fi
NODE_VER=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if (( NODE_MAJOR < NODE_MIN_MAJOR )); then
  err "Node major version must be >= ${NODE_MIN_MAJOR}. Found ${NODE_VER}"
fi
print "Using Node ${NODE_VER}"

# Stop existing service if present
if systemctl list-units --full -all | grep -Fq "${SERVICE_NAME}.service"; then
  print "Stopping existing ${SERVICE_NAME} service (if active)"
  systemctl stop ${SERVICE_NAME}.service || true
fi

# Backup existing install
if [[ -d "${INSTALL_DIR}" ]]; then
  TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
  BACKUP_DIR="${INSTALL_DIR}.bak.${TIMESTAMP}"
  print "Backing up existing install ${INSTALL_DIR} -> ${BACKUP_DIR}"
  mv "${INSTALL_DIR}" "${BACKUP_DIR}"
fi

# Create deploy user if not exists
if ! id -u nexdigi >/dev/null 2>&1; then
  print "Creating system user 'nexdigi'"
  useradd -r -s /bin/false nexdigi || true
fi

# Copy files into place
print "Copying files to ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
cp -r "${REPO_ROOT}/"* "${INSTALL_DIR}/"
chown -R nexdigi:dialout "${INSTALL_DIR}" || true

# Install production dependencies as the deploy user
print "Installing production npm dependencies (this may take a few minutes)"
# Prefer npm ci for reproducible installs when package-lock.json exists; otherwise fallback to npm install
if [[ -f "${INSTALL_DIR}/package-lock.json" ]]; then
  print "Using npm ci for reproducible install"
  # Use a shared npm cache dir for speed / reuse (under /var/cache/nexdigi-npm)
  mkdir -p /var/cache/nexdigi-npm
  chown -R nexdigi:dialout /var/cache/nexdigi-npm || true
  sudo -u nexdigi bash -lc "cd '${INSTALL_DIR}' && npm ci --cache /var/cache/nexdigi-npm --prefer-offline"
else
  sudo -u nexdigi bash -lc "cd '${INSTALL_DIR}' && npm install --production --cache /var/cache/nexdigi-npm --prefer-offline"
fi

# Preserve /etc/default/nexdigi if present by copying it into the new install directory for backup
if [[ -f /etc/default/nexdigi ]]; then
  print "Backing up existing /etc/default/nexdigi to install directory"
  cp /etc/default/nexdigi "${INSTALL_DIR}/.etc-default-nexdigi.bak" || true
fi

# Install systemd unit
if [[ -f "${INSTALL_DIR}/deploy/nexdigi.service" ]]; then
  print "Installing systemd unit"
  cp "${INSTALL_DIR}/deploy/nexdigi.service" /etc/systemd/system/${SERVICE_NAME}.service
  systemctl daemon-reload
  systemctl enable --now ${SERVICE_NAME}.service
  print "Service ${SERVICE_NAME} enabled and started"
else
  print "Warning: deploy/nexdigi.service not found; skipping service install"
fi

print "Installation complete. Check 'journalctl -u ${SERVICE_NAME} -f' for logs."
