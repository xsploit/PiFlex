param(
    [string]$Source = 'http://127.0.0.1:8794',
    [ValidateRange(1024, 65535)][int]$Port = 8795
)
$ErrorActionPreference = 'Stop'
$env:BITEDJ_SOURCE = $Source
$env:BITEDJ_OVERLAY_PORT = [string]$Port
& node (Join-Path $PSScriptRoot 'server.mjs')
