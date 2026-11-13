<#
.SYNOPSIS
    Starts the Thoth Notes sync server on the local network.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1
    powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1 -Port 9443
#>
[CmdletBinding()]
param(
    [int]$Port = 0,
    [string]$PublicUrl = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$venvPython = Join-Path $backend '.venv\Scripts\python.exe'

if (-not (Test-Path $venvPython)) {
    throw 'Server is not installed yet. Run scripts\install-windows.ps1 first.'
}

if ($Port -gt 0) { $env:THOTH_PORT = $Port }
if ($PublicUrl) {
    & $venvPython -m app.cli public-url $PublicUrl | Out-Null
    Write-Host "  Using trusted address $PublicUrl - no local certificate."
}

Push-Location $backend
try {
    & $venvPython -m app
} finally {
    Pop-Location
}
