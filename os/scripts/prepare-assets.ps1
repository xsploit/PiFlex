param(
    [string]$BiteDjRootfs = (Join-Path $PSScriptRoot '..\..\artifacts\bitedj-pi-arm64-pflx-rootfs.tar.gz')
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workspace = (Resolve-Path (Join-Path $project '..')).Path
$assets = Join-Path $project 'assets'
$edmcTarget = Join-Path $assets 'edmc-companion'
$controllerTarget = Join-Path $assets 'controllers'

New-Item -ItemType Directory -Force -Path $assets, $edmcTarget, $controllerTarget | Out-Null

$rootfs = (Resolve-Path -LiteralPath $BiteDjRootfs).Path
Copy-Item -LiteralPath $rootfs -Destination (Join-Path $assets 'bitedj-rootfs.tar.gz') -Force

$edmcSource = Join-Path $workspace 'edmc-companion'
Copy-Item -LiteralPath (Join-Path $edmcSource 'package.json') -Destination $edmcTarget -Force
Copy-Item -LiteralPath (Join-Path $edmcSource 'package-lock.json') -Destination $edmcTarget -Force
foreach ($directory in 'src', 'public') {
    Copy-Item -LiteralPath (Join-Path $edmcSource $directory) -Destination $edmcTarget -Recurse -Force
}

$controllerSource = Join-Path $workspace 'res\controllers'
foreach ($file in 'Pioneer-DDJ-FLX6-script.js', 'Pioneer-DDJ-FLX6.midi.xml') {
    Copy-Item -LiteralPath (Join-Path $controllerSource $file) -Destination $controllerTarget -Force
}

$manifest = Get-ChildItem -LiteralPath $assets -File -Recurse |
    Where-Object Name -ne 'SHA256SUMS.txt' |
    Sort-Object FullName |
    ForEach-Object {
        $relative = [IO.Path]::GetRelativePath($assets, $_.FullName).Replace('\', '/')
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
        "$hash  $relative"
    }
$manifest | Set-Content -LiteralPath (Join-Path $assets 'SHA256SUMS.txt') -Encoding ascii

[pscustomobject]@{
    Assets = $assets
    BiteDJ = (Join-Path $assets 'bitedj-rootfs.tar.gz')
    EdmcFiles = (Get-ChildItem -LiteralPath $edmcTarget -File -Recurse).Count
    ControllerFiles = (Get-ChildItem -LiteralPath $controllerTarget -File).Count
}
