<#
.SYNOPSIS
    Writes a ZIP backup of the Windows archive immediately.

.DESCRIPTION
    Backups land in backend\storage\backups and the newest seven are kept.
    The same archive format can be restored from the iPad backup screen.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$venvPython = Join-Path $backend '.venv\Scripts\python.exe'

if (-not (Test-Path $venvPython)) {
    throw 'Server is not installed yet. Run scripts\install-windows.ps1 first.'
}

Push-Location $backend
try {
    & $venvPython -m app.cli backup --reason powershell
} finally {
    Pop-Location
}
