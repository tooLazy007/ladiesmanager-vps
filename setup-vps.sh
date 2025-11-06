#!/bin/bash

# ============================================================================
# Ladies Manager - VPS Setup Script
# ============================================================================
# This script:
# 1. Updates system & cleans up zombies
# 2. Installs/checks Node.js
# 3. Installs PM2 process manager
# 4. Installs Nginx
# 5. Configures firewall
# 6. Sets up SSL (Let's Encrypt)
# 7. Starts the service
# ============================================================================

set -e  # Exit on any error

echo ""
echo "============================================"
echo " Ladies Manager - VPS Setup"
echo "============================================"
echo ""

# ============================================================================
# 1. System Update & Zombie Cleanup
# ============================================================================

echo "📦 Step 1: System Update & Zombie Cleanup"
echo ""

# Kill zombie processes
echo "🧟 Cleaning up zombie processes..."
ps aux | grep 'Z' | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
echo "✅ Zombie processes cleaned"

# Update system
echo "📦 Updating system packages..."
apt-get update -y
apt-get upgrade -y
echo "✅ System updated"

# Install essential packages
echo "📦 Installing essential packages..."
apt-get install -y curl wget git build-essential
echo "✅ Essential packages installed"

echo ""

# ============================================================================
# 2. Node.js Check/Installation
# ============================================================================

echo "📦 Step 2: Node.js Check/Installation"
echo ""

if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
    
    echo "✅ Node.js already installed: $NODE_VERSION"
    
    if [ "$NODE_MAJOR" -lt 18 ]; then
        echo "⚠️  Node.js version too old (need 18+), upgrading..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
        echo "✅ Node.js upgraded to $(node -v)"
    fi
else
    echo "📥 Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    echo "✅ Node.js installed: $(node -v)"
fi

echo "   Node.js: $(node -v)"
echo "   npm: $(npm -v)"

echo ""

# ============================================================================
# 3. Install PM2
# ============================================================================

echo "📦 Step 3: PM2 Installation"
echo ""

if command -v pm2 &> /dev/null; then
    echo "✅ PM2 already installed: $(pm2 -v)"
else
    echo "📥 Installing PM2..."
    npm install -g pm2
    echo "✅ PM2 installed: $(pm2 -v)"
fi

# Enable PM2 startup
pm2 startup systemd -u root --hp /root
echo "✅ PM2 startup configured"

echo ""

# ============================================================================
# 4. Install Nginx
# ============================================================================

echo "📦 Step 4: Nginx Installation"
echo ""

if command -v nginx &> /dev/null; then
    echo "✅ Nginx already installed"
else
    echo "📥 Installing Nginx..."
    apt-get install -y nginx
    echo "✅ Nginx installed"
fi

# Enable Nginx
systemctl enable nginx
systemctl start nginx
echo "✅ Nginx enabled and started"

echo ""

# ============================================================================
# 5. Firewall Configuration
# ============================================================================

echo "📦 Step 5: Firewall Configuration"
echo ""

if command -v ufw &> /dev/null; then
    echo "🔥 Configuring UFW firewall..."
    ufw allow 22/tcp   # SSH
    ufw allow 80/tcp   # HTTP
    ufw allow 443/tcp  # HTTPS
    ufw --force enable
    echo "✅ Firewall configured"
else
    echo "⚠️  UFW not installed, skipping firewall setup"
fi

echo ""

# ============================================================================
# 6. Project Setup
# ============================================================================

echo "📦 Step 6: Project Setup"
echo ""

# Get current directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
echo "📁 Project directory: $SCRIPT_DIR"

# Install npm dependencies
echo "📥 Installing npm dependencies..."
cd "$SCRIPT_DIR"
npm install
echo "✅ Dependencies installed"

# Create downloads directory
mkdir -p "$SCRIPT_DIR/downloads"
echo "✅ Downloads directory created"

echo ""

# ============================================================================
# 7. Nginx Configuration
# ============================================================================

echo "📦 Step 7: Nginx Configuration"
echo ""

NGINX_CONF="/etc/nginx/sites-available/ladiesmanager"

echo "📝 Creating Nginx configuration..."
cat > "$NGINX_CONF" << 'EOF'
server {
    listen 80;
    server_name ladiesmanager.srv879239.hstgr.cloud;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Increase timeout for long-running generations
        proxy_read_timeout 600s;
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
    }
}
EOF

# Enable site
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/ladiesmanager

# Remove default site
rm -f /etc/nginx/sites-enabled/default

# Test Nginx config
nginx -t

# Reload Nginx
systemctl reload nginx

echo "✅ Nginx configured"

echo ""

# ============================================================================
# 8. SSL Certificate (Let's Encrypt)
# ============================================================================

echo "📦 Step 8: SSL Certificate Setup"
echo ""

if command -v certbot &> /dev/null; then
    echo "✅ Certbot already installed"
else
    echo "📥 Installing Certbot..."
    apt-get install -y certbot python3-certbot-nginx
    echo "✅ Certbot installed"
fi

echo ""
echo "⚠️  IMPORTANT: SSL Certificate Setup"
echo ""
echo "To enable HTTPS, run this command MANUALLY after setup:"
echo ""
echo "  certbot --nginx -d ladiesmanager.srv879239.hstgr.cloud"
echo ""
echo "This will:"
echo "  1. Obtain SSL certificate from Let's Encrypt"
echo "  2. Configure Nginx for HTTPS"
echo "  3. Set up auto-renewal"
echo ""
echo "Press ENTER to continue (we'll skip auto-SSL for now)..."
read

echo ""

# ============================================================================
# 9. PM2 Startup
# ============================================================================

echo "📦 Step 9: Starting Service with PM2"
echo ""

# Stop any existing PM2 processes
pm2 delete all 2>/dev/null || true

# Start server with PM2
cd "$SCRIPT_DIR"
pm2 start server.js --name ladiesmanager --time

# Save PM2 process list
pm2 save

echo "✅ Service started with PM2"

echo ""

# ============================================================================
# 10. Check n8n
# ============================================================================

echo "📦 Step 10: Checking n8n Status"
echo ""

if pm2 list | grep -q "n8n"; then
    echo "✅ n8n is running (protected)"
elif systemctl list-units --type=service | grep -q "n8n"; then
    echo "✅ n8n service is running (protected)"
else
    echo "ℹ️  n8n not detected or not running"
fi

echo ""

# ============================================================================
# Done!
# ============================================================================

echo ""
echo "============================================"
echo " ✅ Setup Complete!"
echo "============================================"
echo ""
echo "Service Status:"
pm2 list
echo ""
echo "Next Steps:"
echo ""
echo "1. Edit config.json and add your credentials:"
echo "   nano $SCRIPT_DIR/config.json"
echo ""
echo "2. Add your API keys in Airtable Configuration table:"
echo "   - FAL_API_KEY"
echo "   - Gemini_API_Key"
echo "   - Face_Reference & Body_Reference images"
echo ""
echo "3. (Optional) Enable SSL certificate:"
echo "   certbot --nginx -d ladiesmanager.srv879239.hstgr.cloud"
echo ""
echo "4. Access your service:"
echo "   http://ladiesmanager.srv879239.hstgr.cloud"
echo ""
echo "5. Useful PM2 commands:"
echo "   pm2 logs ladiesmanager    # View logs"
echo "   pm2 restart ladiesmanager # Restart service"
echo "   pm2 stop ladiesmanager    # Stop service"
echo "   pm2 monit                 # Monitor resources"
echo ""
echo "============================================"
echo ""
