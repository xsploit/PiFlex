param(
    [string]$BiteDjRootfs = (Join-Path $PSScriptRoot '..\..\artifacts\bitedj-pi-arm64-pflx-rootfs.tar.gz'),
    [string]$BootScreenBinary = (Join-Path $PSScriptRoot '..\..\artifacts\boot-screen\pflx-boot-screen')
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workspace = (Resolve-Path (Join-Path $project '..')).Path
$assets = Join-Path $project 'assets'
$edmcTarget = Join-Path $assets 'edmc-companion'
$controllerTarget = Join-Path $assets 'controllers'
$bootTarget = Join-Path $assets 'boot-screen'

$bootBinary = (Resolve-Path -LiteralPath $BootScreenBinary).Path

New-Item -ItemType Directory -Force -Path $assets, $edmcTarget, $controllerTarget, $bootTarget | Out-Null
Copy-Item -LiteralPath $bootBinary -Destination (Join-Path $bootTarget 'pflx-boot-screen') -Force
Copy-Item -LiteralPath (Join-Path $project 'boot-screen\piflex-logo.svg') -Destination $bootTarget -Force
foreach ($name in 'Ubuntu-R.ttf', 'Ubuntu.LICENCE.txt') {
    Copy-Item -LiteralPath (Join-Path $workspace "res\fonts\$name") -Destination $bootTarget -Force
}

$rootfs = (Resolve-Path -LiteralPath $BiteDjRootfs).Path
Copy-Item -LiteralPath $rootfs -Destination (Join-Path $assets 'bitedj-rootfs.tar.gz') -Force

$edmcSource = Join-Path $workspace 'edmc-companion'
Copy-Item -LiteralPath (Join-Path $edmcSource 'package.json') -Destination $edmcTarget -Force
Copy-Item -LiteralPath (Join-Path $edmcSource 'package-lock.json') -Destination $edmcTarget -Force
foreach ($directory in 'src', 'public') {
    Copy-Item -LiteralPath (Join-Path $edmcSource $directory) -Destination $edmcTarget -Recurse -Force
}

$controllerSource = Join-Path $workspace 'res\controllers'
foreach ($file in 'Pioneer-DDJ-FLX6-script.js', 'Pioneer-DDJ-FLX6.midi.xml', 'piflex-padfx.js') {
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
