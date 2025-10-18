#
# NexDigi Client-Only Installation Script
# For Windows with PowerShell
#
# Usage: Run as Administrator: .\install-client.ps1
#

# Require Administrator
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Error "This script must be run as Administrator"
    exit 1
}

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "NexDigi Client-Only Installation" -ForegroundColor Cyan
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

# Install client dependencies and build
Write-Host ""
Write-Host "Installing NexDigi client dependencies..." -ForegroundColor Yellow
Set-Location client
npm install
npm run build
Set-Location ..

# Install http-server globally for serving static files
Write-Host ""
Write-Host "Installing http-server..." -ForegroundColor Yellow
npm install -g http-server

# Install directory
$installDir = "C:\NexDigi-Client"

Write-Host ""
Write-Host "Installing to $installDir..." -ForegroundColor Yellow
if (Test-Path $installDir) {
    $backupDir = "C:\NexDigi-Client.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
    Write-Host "Backing up existing installation to $backupDir..." -ForegroundColor Yellow
    Move-Item $installDir $backupDir
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item -Path ".\client\dist\*" -Destination $installDir -Recurse -Force

# Install NSSM for service management
Write-Host ""
Write-Host "Installing NSSM (service manager)..." -ForegroundColor Yellow
$nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
$nssmZip = "$env:TEMP\nssm.zip"
$nssmDir = "$env:TEMP\nssm"

Invoke-WebRequest -Uri $nssmUrl -OutFile $nssmZip
Expand-Archive -Path $nssmZip -DestinationPath $nssmDir -Force
$nssmExe = "$nssmDir\nssm-2.24\win64\nssm.exe"

# Create Windows service for http-server
Write-Host ""
Write-Host "Creating NexDigi Client Windows service..." -ForegroundColor Yellow

# Remove existing service if present
& $nssmExe stop NexDigi-Client 2>$null
& $nssmExe remove NexDigi-Client confirm 2>$null

# Get http-server path
$httpServerPath = (Get-Command http-server).Source

# Install new service
& $nssmExe install NexDigi-Client "$(Get-Command node).Source" "`"$httpServerPath`" `"$installDir`" -p 80 -c-1 --gzip"
& $nssmExe set NexDigi-Client AppDirectory $installDir
& $nssmExe set NexDigi-Client DisplayName "NexDigi Web UI"
& $nssmExe set NexDigi-Client Description "NexDigi web interface for remote server management"
& $nssmExe set NexDigi-Client Start SERVICE_AUTO_START
& $nssmExe set NexDigi-Client AppStdout "$installDir\client.log"
& $nssmExe set NexDigi-Client AppStderr "$installDir\client-error.log"
& $nssmExe set NexDigi-Client AppRotateFiles 1
& $nssmExe set NexDigi-Client AppRotateBytes 10485760

# Copy NSSM to install directory for future use
Copy-Item $nssmExe "$installDir\nssm.exe"
Remove-Item $nssmZip
Remove-Item $nssmDir -Recurse

# Configure firewall
Write-Host ""
Write-Host "Configuring Windows Firewall..." -ForegroundColor Yellow
netsh advfirewall firewall delete rule name="NexDigi Client HTTP" 2>$null
netsh advfirewall firewall add rule name="NexDigi Client HTTP" dir=in action=allow protocol=TCP localport=80

# Start service
Write-Host ""
Write-Host "Starting NexDigi Client service..." -ForegroundColor Yellow
Start-Service NexDigi-Client

# Wait for service to start
Start-Sleep -Seconds 3

# Check service status
$service = Get-Service NexDigi-Client
if ($service.Status -eq "Running") {
    Write-Host ""
    Write-Host "======================================" -ForegroundColor Green
    Write-Host "✓ NexDigi client installed successfully!" -ForegroundColor Green
    Write-Host "======================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Web UI: http://localhost" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Configuration:" -ForegroundColor Yellow
    Write-Host "  When you first open the UI, you'll be prompted to configure" -ForegroundColor Yellow
    Write-Host "  the remote NexDigi server connection." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Server host format: hostname:port" -ForegroundColor Cyan
    Write-Host "  Example: 192.168.1.100:3000" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "View logs:  Get-Content $installDir\client.log -Wait" -ForegroundColor Cyan
    Write-Host "Stop:       Stop-Service NexDigi-Client" -ForegroundColor Cyan
    Write-Host "Restart:    Restart-Service NexDigi-Client" -ForegroundColor Cyan
    Write-Host "Status:     Get-Service NexDigi-Client" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "======================================" -ForegroundColor Red
    Write-Host "⚠️  Service failed to start" -ForegroundColor Red
    Write-Host "======================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Check logs: Get-Content $installDir\client-error.log" -ForegroundColor Yellow
    exit 1
}
