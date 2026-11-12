<#
.SYNOPSIS
    Installs the Thoth Notes Windows server: virtual environment, dependencies,
    database, pairing token and a locally trusted HTTPS certificate.

.DESCRIPTION
    Run once from an ordinary PowerShell window. The script installs Python
    packages from PyPI and nothing else; it never opens the server to the public
    Internet. All user data lives under backend\storage.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipFrontend,
    [string[]]$ExtraIp = @()
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$venv = Join-Path $backend '.venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'

Write-Host ''
Write-Host '  Thoth Notes - Windows setup' -ForegroundColor Green
Write-Host '  ---------------------------'
Write-Host "  Project: $root"

# 1. Locate Python 3.12+ -------------------------------------------------------
$candidates = @(
    @{ Exe = 'py'; Args = @('-3.13') },
    @{ Exe = 'py'; Args = @('-3.12') },
    @{ Exe = 'python'; Args = @() }
)

$pythonChoice = $null
foreach ($candidate in $candidates) {
    $exe = $candidate.Exe
    $pre = @($candidate.Args)
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
    try {
        $reported = & $exe @pre -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
    } catch {
        continue
    }
    $value = @($reported)[0]
    if ($value -and ([version]$value -ge [version]'3.12')) {
        $pythonChoice = $candidate
        break
    }
}

if (-not $pythonChoice) {
    throw 'Python 3.12 or newer was not found. Install it from https://www.python.org/downloads/windows/ and tick "Add python.exe to PATH".'
}
$pyExe = $pythonChoice.Exe
$pyPre = @($pythonChoice.Args)
Write-Host "  Python: $pyExe $($pyPre -join ' ')"

# 2. Virtual environment and dependencies -------------------------------------
if (-not (Test-Path $venvPython)) {
    Write-Host '  Creating virtual environment...'
    & $pyExe @pyPre -m venv $venv
}
if (-not (Test-Path $venvPython)) {
    throw "Virtual environment creation failed at $venv"
}

Write-Host '  Installing Python dependencies...'
& $venvPython -m pip install --upgrade pip --quiet
& $venvPython -m pip install -r (Join-Path $backend 'requirements.txt') --quiet

# 3. Database, token and certificate ------------------------------------------
Write-Host '  Preparing database, pairing token and certificate...'
Push-Location $backend
try {
    $initArgs = @()
    foreach ($ip in $ExtraIp) { $initArgs += @('--ip', $ip) }
    & $venvPython -m app.cli init @initArgs
} finally {
    Pop-Location
}

# 4. Optional frontend build (lets the server host the app itself) ------------
if (-not $SkipFrontend -and (Test-Path (Join-Path $frontend 'package.json'))) {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if ($npm) {
        Write-Host '  Building the frontend so the server can host it...'
        Push-Location $frontend
        try {
            if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
                & npm install --no-audit --no-fund
            }
            & npm run build
        } finally {
            Pop-Location
        }
    } else {
        Write-Host '  Node.js not found - the GitHub Pages build is unaffected.' -ForegroundColor Yellow
    }
}

# 5. Firewall rule (private networks and local subnet only) --------------------
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin -and (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue)) {
    try {
        if (-not (Get-NetFirewallRule -DisplayName 'Thoth Notes' -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName 'Thoth Notes' -Direction Inbound -Action Allow `
                -Protocol TCP -LocalPort 8443 -Profile Private -RemoteAddress LocalSubnet | Out-Null
            Write-Host '  Firewall rule created (private networks, local subnet only).'
        }
    } catch {
        Write-Host '  Could not create the firewall rule; allow TCP 8443 manually on private networks.' -ForegroundColor Yellow
    }
} else {
    Write-Host '  Firewall rule skipped (not elevated). Run scripts\allow-firewall.ps1 in an admin window if the iPad cannot connect.' -ForegroundColor Yellow
}

$tokenPath = Join-Path $backend 'storage\pairing-token.txt'
$token = if (Test-Path $tokenPath) { (Get-Content $tokenPath -Raw).Trim() } else { '(see backend\storage\pairing-token.txt)' }

Write-Host ''
Write-Host '  Setup complete.' -ForegroundColor Green
Write-Host "  Pairing token : $token"
Write-Host '  Certificate   : backend\storage\certs\thoth-rootCA.cer'
Write-Host '  Start server  : powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1'
Write-Host ''
