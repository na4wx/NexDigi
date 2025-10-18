#
# NexDigi Server-Only Installation Script
# For Windows with PowerShell
#
# Usage: Run as Administrator: .\install-server.ps1
#

# Require Administrator
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Error "This script must be run as Administrator"
    exit 1
}

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "NexDigi Server-Only Installation" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Check for Node.js
$nodeVersion = $null
try {
    $nodeVersion = node --version
    $majorVersion = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($majorVersion -lt 18) {
        Write-Host "Node.js version $nodeVersion detected. Upgrading to 18.x..." -ForegroundColor Yellow
        $installNode = $true
    } else {
        Write-Host "Node.js $nodeVersion detected. OK." -ForegroundColor Green
        $installNode = $false
    }
} catch {
    Write-Host "Node.js not found. Installing Node.js 18.x..." -ForegroundColor Yellow
    $installNode = $true
}

# Install Node.js if needed
if ($installNode) {
    $nodeUrl = "https://nodejs.org/dist/v18.19.0/node-v18.19.0-x64.msi"
    $nodeMsi = "$env:TEMP\node-installer.msi"
    
    Write-Host "Downloading Node.js..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi
    
    Write-Host "Installing Node.js..." -ForegroundColor Yellow
    Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /qn /norestart" -Wait
    
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    
    Remove-Item $nodeMsi
    Write-Host "Node.js installed successfully." -ForegroundColor Green
}

# Install server dependencies only
Write-Host ""
Write-Host "Installing NexDigi server dependencies..." -ForegroundColor Yellow
npm install --production --omit=dev

# Install directory
$installDir = "C:\NexDigi"

Write-Host ""
Write-Host "Installing to $installDir..." -ForegroundColor Yellow
if (Test-Path $installDir) {
    $backupDir = "C:\NexDigi.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
    Write-Host "Backing up existing installation to $backupDir..." -ForegroundColor Yellow
    Move-Item $installDir $backupDir
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null

# Copy only server files
Copy-Item -Path ".\server" -Destination $installDir -Recurse -Force
Copy-Item -Path ".\node_modules" -Destination $installDir -Recurse -Force
Copy-Item -Path ".\package.json" -Destination $installDir -Force
Copy-Item -Path ".\package-lock.json" -Destination $installDir -Force
Copy-Item -Path ".\LICENSE" -Destination $installDir -Force
Copy-Item -Path ".\README.md" -Destination $installDir -Force

# Install NSSM for service management
Write-Host ""
Write-Host "Installing NSSM (service manager)..." -ForegroundColor Yellow
$nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
$nssmZip = "$env:TEMP\nssm.zip"
$nssmDir = "$env:TEMP\nssm"

Invoke-WebRequest -Uri $nssmUrl -OutFile $nssmZip
Expand-Archive -Path $nssmZip -DestinationPath $nssmDir -Force
$nssmExe = "$nssmDir\nssm-2.24\win64\nssm.exe"

# Create Windows service
Write-Host ""
Write-Host "Creating NexDigi Windows service..." -ForegroundColor Yellow

# Remove existing service if present
& $nssmExe stop NexDigi 2>$null
& $nssmExe remove NexDigi confirm 2>$null

# Install new service
& $nssmExe install NexDigi "$(Get-Command node).Source" "$installDir\server\index.js"
& $nssmExe set NexDigi AppDirectory $installDir
& $nssmExe set NexDigi DisplayName "NexDigi Packet Radio Suite (Server Only)"
& $nssmExe set NexDigi Description "NexDigi headless server with API and WebSocket endpoints"
& $nssmExe set NexDigi Start SERVICE_AUTO_START
& $nssmExe set NexDigi AppStdout "$installDir\nexdigi.log"
& $nssmExe set NexDigi AppStderr "$installDir\nexdigi-error.log"
& $nssmExe set NexDigi AppRotateFiles 1
& $nssmExe set NexDigi AppRotateBytes 10485760

# Copy NSSM to install directory for future use
Copy-Item $nssmExe "$installDir\nssm.exe"
Remove-Item $nssmZip
Remove-Item $nssmDir -Recurse

# Configure firewall
Write-Host ""
Write-Host "Configuring Windows Firewall..." -ForegroundColor Yellow
netsh advfirewall firewall delete rule name="NexDigi HTTP" 2>$null
netsh advfirewall firewall delete rule name="NexDigi WebSocket" 2>$null
netsh advfirewall firewall add rule name="NexDigi HTTP" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="NexDigi WebSocket" dir=in action=allow protocol=TCP localport=3000

# Start service
Write-Host ""
Write-Host "Starting NexDigi service..." -ForegroundColor Yellow
Start-Service NexDigi

# Wait for service to start
Start-Sleep -Seconds 5

# Check service status
$service = Get-Service NexDigi
if ($service.Status -eq "Running") {
    Write-Host ""
    Write-Host "======================================" -ForegroundColor Green
    Write-Host "✓ NexDigi server installed successfully!" -ForegroundColor Green
    Write-Host "======================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Server API: http://localhost:3000" -ForegroundColor Cyan
    Write-Host "WebSocket:  ws://localhost:3000" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Default UI password: changeme" -ForegroundColor Yellow
    Write-Host "⚠️  IMPORTANT: Change the password in $installDir\server\config.json" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "View logs:  Get-Content $installDir\nexdigi.log -Wait" -ForegroundColor Cyan
    Write-Host "Stop:       Stop-Service NexDigi" -ForegroundColor Cyan
    Write-Host "Restart:    Restart-Service NexDigi" -ForegroundColor Cyan
    Write-Host "Status:     Get-Service NexDigi" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Note: This is a headless server installation." -ForegroundColor Yellow
    Write-Host "To access the web UI, install the client on another machine." -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "======================================" -ForegroundColor Red
    Write-Host "⚠️  Service failed to start" -ForegroundColor Red
    Write-Host "======================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Check logs: Get-Content $installDir\nexdigi-error.log" -ForegroundColor Yellow
    exit 1
}
