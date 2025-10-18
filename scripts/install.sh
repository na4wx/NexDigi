#!/bin/bash
#
# NexDigi Full Installation Script (Server + Client)
# For Debian/Ubuntu Linux
#
# Usage: sudo ./install.sh
#

set -e

echo "======================================"
echo "NexDigi Full Installation"
echo "======================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Error: This script must be run as root"
  echo "Usage: sudo ./install.sh"
  exit 1
fi

# Detect Node.js
if ! command -v node &> /dev/null; then
  echo "Node.js not found. Installing Node.js 18.x..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y nodejs
else
  NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    echo "Node.js version $NODE_VERSION detected. Upgrading to 18.x..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
  else
    echo "Node.js $(node --version) detected. OK."
  fi
fi

# Install system dependencies
echo ""
echo "Installing system dependencies..."
apt-get update
apt-get install -y build-essential git

# Install server dependencies
echo ""
echo "Installing NexDigi server dependencies..."
npm install --production

# Install client dependencies
echo ""
echo "Installing NexDigi client dependencies..."
cd client
npm install
npm run build
cd ..

# Create nexdigi user if it doesn't exist
if ! id -u nexdigi &>/dev/null; then
  echo ""
  echo "Creating nexdigi system user..."
  useradd --system --home-dir /opt/nexdigi --shell /bin/bash --create-home nexdigi
  usermod -a -G dialout nexdigi
fi

# Install to /opt/nexdigi
echo ""
echo "Installing to /opt/nexdigi..."
if [ -d "/opt/nexdigi" ]; then
  BACKUP_DIR="/opt/nexdigi.bak.$(date +%Y%m%d_%H%M%S)"
  echo "Backing up existing installation to $BACKUP_DIR..."
  mv /opt/nexdigi "$BACKUP_DIR"
fi

mkdir -p /opt/nexdigi
cp -r ./* /opt/nexdigi/
chown -R nexdigi:nexdigi /opt/nexdigi

# Create systemd service
echo ""
echo "Creating systemd service..."
cat > /etc/systemd/system/nexdigi.service <<'EOF'
[Unit]
Description=NexDigi Packet Radio Suite
After=network.target

[Service]
Type=simple
User=nexdigi
WorkingDirectory=/opt/nexdigi
ExecStart=/usr/bin/node /opt/nexdigi/server/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=nexdigi
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
echo ""
echo "Starting NexDigi service..."
systemctl daemon-reload
systemctl enable nexdigi
systemctl restart nexdigi

# Wait for service to start
sleep 3

# Check service status
if systemctl is-active --quiet nexdigi; then
  echo ""
  echo "======================================"
  echo "✓ NexDigi installed successfully!"
  echo "======================================"
  echo ""
  echo "Server is running at: http://localhost:3000"
  echo ""
  echo "Default UI password: changeme"
  echo "⚠️  IMPORTANT: Change the password in /opt/nexdigi/server/config.json"
  echo ""
  echo "View logs:  journalctl -u nexdigi -f"
  echo "Stop:       sudo systemctl stop nexdigi"
  echo "Restart:    sudo systemctl restart nexdigi"
  echo ""
else
  echo ""
  echo "======================================"
  echo "⚠️  Service failed to start"
  echo "======================================"
  echo ""
  echo "Check logs: journalctl -u nexdigi -xe"
  exit 1
fi
