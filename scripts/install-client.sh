#!/bin/bash
#
# NexDigi Client-Only Installation Script
# For Debian/Ubuntu Linux
#
# Usage: sudo ./install-client.sh
#

set -e

echo "======================================"
echo "NexDigi Client-Only Installation"
echo "======================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Error: This script must be run as root"
  echo "Usage: sudo ./install-client.sh"
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
apt-get install -y nginx git

# Install client dependencies
echo ""
echo "Installing NexDigi client dependencies..."
cd client
npm install
npm run build
cd ..

# Install to /var/www/nexdigi
echo ""
echo "Installing client to /var/www/nexdigi..."
if [ -d "/var/www/nexdigi" ]; then
  BACKUP_DIR="/var/www/nexdigi.bak.$(date +%Y%m%d_%H%M%S)"
  echo "Backing up existing installation to $BACKUP_DIR..."
  mv /var/www/nexdigi "$BACKUP_DIR"
fi

mkdir -p /var/www/nexdigi
cp -r ./client/dist/* /var/www/nexdigi/
chown -R www-data:www-data /var/www/nexdigi

# Configure nginx
echo ""
echo "Configuring nginx..."
cat > /etc/nginx/sites-available/nexdigi <<'EOF'
server {
    listen 80;
    server_name _;
    
    root /var/www/nexdigi;
    index index.html;
    
    # Serve static files
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
    
    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# Enable site
ln -sf /etc/nginx/sites-available/nexdigi /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test nginx config
nginx -t

# Restart nginx
systemctl restart nginx
systemctl enable nginx

echo ""
echo "======================================"
echo "✓ NexDigi client installed successfully!"
echo "======================================"
echo ""
echo "Web UI: http://localhost"
echo ""
echo "Configuration:"
echo "  When you first open the UI, you'll be prompted to configure"
echo "  the remote NexDigi server connection."
echo ""
echo "  Server host format: hostname:port"
echo "  Example: 192.168.1.100:3000"
echo ""
echo "Nginx logs:  tail -f /var/log/nginx/access.log"
echo "Restart:     sudo systemctl restart nginx"
echo ""
