<#
PowerShell helper to install NexDigi as a Windows service using NSSM (recommended) or sc.exe as a fallback.
Usage:
  - Run in an elevated PowerShell prompt.
  - Edit the variables below to match your installation path and Node binary location.

This script will try to use NSSM (https://nssm.cc/) if available. If NSSM is not found it will fall back to creating a simple service with sc.exe which does not manage Node well on crashes.
#>

param(
    [string]$InstallPath = "C:\\opt\\nexdigi",
    [string]$NodeExe = "C:\\Program Files\\nodejs\\node.exe",
    [string]$ServiceName = "NexDigi",
    [string]$ServiceUser = "LocalSystem"
)

function Write-Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Err($m){ Write-Host "[ERROR] $m" -ForegroundColor Red }

# Validate
if (-not (Test-Path $NodeExe)) {
    Write-Err "Node executable not found at $NodeExe. Update the script or install Node.js."
    exit 1
}
if (-not (Test-Path $InstallPath)) {
    Write-Err "Install path $InstallPath does not exist. Create it and copy NexDigi files there, or pass -InstallPath."
    exit 1
}

# Try to find nssm
$nssmPath = (Get-Command nssm -ErrorAction SilentlyContinue)?.Source
if ($nssmPath) {
    Write-Info "Found NSSM at $nssmPath. Installing service via NSSM."
    & $nssmPath install $ServiceName "$NodeExe" "$InstallPath\server\index.js"
    & $nssmPath set $ServiceName AppDirectory $InstallPath
    & $nssmPath set $ServiceName AppEnvironmentExtra "NODE_ENV=production;PORT=3000"
    & $nssmPath set $ServiceName Start SERVICE_AUTO_START
    Write-Info "Starting service $ServiceName"
    & $nssmPath start $ServiceName
    Write-Info "Service installed via NSSM."
    exit 0
}

Write-Info "NSSM not found. Falling back to sc.exe (note: sc.exe does not provide robust process supervision)."
$bin = "$NodeExe"
$args = "`"$InstallPath\\server\\index.js`""
# Create the service
$createCmd = "sc.exe create $ServiceName binPath= `"$bin $args`" start= auto obj= `$ServiceUser`"
Write-Info "Running: $createCmd"
Invoke-Expression $createCmd
Write-Info "Starting service $ServiceName"
sc.exe start $ServiceName
Write-Info "Service creation attempted. Check Windows Services manager for status."
