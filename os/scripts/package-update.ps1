param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist')
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$pflxRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$archive = Join-Path $projectRoot 'artifacts\bitedj-pi-arm64-pflx-rootfs.tar.gz'
$edmc = Join-Path $projectRoot 'edmc-companion'
$staging = Join-Path $env:TEMP ('pflx-update-' + [guid]::NewGuid().ToString('N'))
$payload = Join-Path $staging 'payload'

New-Item -ItemType Directory -Force -Path $payload, $OutputDirectory | Out-Null
try {
    tar -xzf $archive -C $payload
    $shareRoot = Join-Path $payload 'usr\local\share'
    Get-ChildItem -LiteralPath $shareRoot -Force | Where-Object Name -ne 'mixxx' |
        Remove-Item -Recurse -Force
    $edmcTarget = Join-Path $payload 'opt\pflx\edmc-companion'
    New-Item -ItemType Directory -Force -Path $edmcTarget | Out-Null
    Copy-Item (Join-Path $edmc 'package.json'), (Join-Path $edmc 'package-lock.json') -Destination $edmcTarget
    Copy-Item (Join-Path $edmc 'src'), (Join-Path $edmc 'public') -Destination $edmcTarget -Recurse
    Copy-Item (Join-Path $edmc 'node_modules') -Destination $edmcTarget -Recurse
    Set-Content -Path (Join-Path $staging 'manifest.txt') -Value ('pflx-dev-' + (Get-Date -AsUTC -Format 'yyyyMMddTHHmmssZ')) -NoNewline

    $output = Join-Path $OutputDirectory 'pflx-update.tar.gz'
    tar -czf $output -C $staging manifest.txt payload
    $hash = (Get-FileHash -Algorithm SHA256 $output).Hash.ToLowerInvariant()
    Set-Content -Path ($output + '.sha256') -Value "$hash  pflx-update.tar.gz"
    Get-Item $output, ($output + '.sha256')
}
finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
