<#
.SYNOPSIS
    Allows inbound TCP 8443 from the local subnet on private networks only.

.DESCRIPTION
    Requires an elevated PowerShell window. The rule never exposes the server
    to the Internet: it is scoped to the Private firewall profile and to
    LocalSubnet remote addresses.
#>
[CmdletBinding()]
param(
    [int]$Port = 8443
)

$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw 'Run this script from an Administrator PowerShell window.'
}

$existing = Get-NetFirewallRule -DisplayName 'Thoth Notes' -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host 'Thoth Notes firewall rule already exists.'
    exit 0
}

New-NetFirewallRule -DisplayName 'Thoth Notes' -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $Port -Profile Private -RemoteAddress LocalSubnet | Out-Null
Write-Host "Created firewall rule for TCP $Port (private networks, local subnet only)."
