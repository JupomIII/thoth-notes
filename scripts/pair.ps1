<#
.SYNOPSIS
    Prints a fresh pairing code and copies a one-tap pairing link.

.DESCRIPTION
    The code changes every ten minutes and never contains the long-lived pairing
    token, so the link is safe to keep in the clipboard or send to your own iPad.
    Open the link on the iPad (AirDrop, Messages or Notes) and the app pairs by
    itself. The code can also be typed by hand on the sync screen.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\pair.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$venvPython = Join-Path $backend '.venv\Scripts\python.exe'

if (-not (Test-Path $venvPython)) {
    throw 'The server is not installed yet. Run scripts\install-windows.ps1 first.'
}

Push-Location $backend
try {
    $json = & $venvPython -m app.cli pair | ConvertFrom-Json
} finally {
    Pop-Location
}

$minutes = [math]::Round([double]$json.expiresIn / 60, 1)

try {
    Set-Clipboard -Value $json.link
    $copied = $true
} catch {
    $copied = $false
}

Write-Host ''
Write-Host '  Pair your iPad' -ForegroundColor Green
Write-Host '  -------------'
Write-Host "  Code        : $($json.code)   (valid another $minutes min)"
Write-Host "  Server      : $($json.serverUrl)"
Write-Host "  Link        : $($json.link)"
if ($copied) {
    Write-Host '  The link is on your clipboard: send it to the iPad and tap it.' -ForegroundColor Green
} else {
    Write-Host '  Copy the link above and open it on the iPad.'
}
Write-Host "  Certificate : $($json.certificate)"
Write-Host ''
