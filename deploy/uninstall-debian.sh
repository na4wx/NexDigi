#!/usr/bin/env bash
# Safe uninstaller for NexDigi on Debian-like systems
# - Stops the service
# - Restores the most recent backup (if present)
# - Removes systemd unit

set -euo pipefail
SERVICE_NAME=nexdigi
INSTALL_DIR=/opt/nexdigi

print() { echo "[nexdigi-uninstall] $*"; }
err() { echo "[nexdigi-uninstall][ERROR] $*" >&2; exit 1; }

if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (use sudo)"
fi

print "Stopping service (if running)"
systemctl stop ${SERVICE_NAME}.service || true

# Find the latest backup matching /opt/nexdigi.bak.*
LATEST_BACKUP=$(ls -d /opt/nexdigi.bak.* 2>/dev/null | sort -r | head -n1 || true)
if [[ -n "$LATEST_BACKUP" && -d "$LATEST_BACKUP" ]]; then
  print "Restoring backup $LATEST_BACKUP -> ${INSTALL_DIR}"
  # remove current install dir and restore backup
  rm -rf "${INSTALL_DIR}" || true
  mv "$LATEST_BACKUP" "${INSTALL_DIR}"
  chown -R nexdigi:dialout "${INSTALL_DIR}" || true
else
  print "No backup found. Removing current install directory ${INSTALL_DIR}"
  rm -rf "${INSTALL_DIR}" || true
fi

# Remove systemd unit
if [[ -f /etc/systemd/system/${SERVICE_NAME}.service ]]; then
  print "Removing systemd unit"
  systemctl disable --now ${SERVICE_NAME}.service || true
  rm -f /etc/systemd/system/${SERVICE_NAME}.service || true
  systemctl daemon-reload || true
fi

print "Uninstall complete. If you want to remove the nexdigi user, do so manually."
