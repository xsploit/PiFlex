param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist'),
    [string]$ApplicationArchive
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$pflxRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$archive = if ($ApplicationArchive) { (Resolve-Path -LiteralPath $ApplicationArchive).Path } else {
    Join-Path $projectRoot 'artifacts\bitedj-pi-arm64-pflx-rootfs.tar.gz'
}
$edmc = Join-Path $projectRoot 'edmc-companion'
$staging = Join-Path $env:TEMP ('pflx-update-' + [guid]::NewGuid().ToString('N'))
$payload = Join-Path $staging 'payload'

New-Item -ItemType Directory -Force -Path $payload, $OutputDirectory | Out-Null
try {
    tar -xzf $archive -C $payload
    if ($LASTEXITCODE -ne 0) { throw 'Application archive extraction failed' }
    $shareRoot = Join-Path $payload 'usr\local\share'
    Get-ChildItem -LiteralPath $shareRoot -Force | Where-Object Name -ne 'mixxx' |
        Remove-Item -Recurse -Force
    $edmcTarget = Join-Path $payload 'opt\pflx\edmc-companion'
    New-Item -ItemType Directory -Force -Path $edmcTarget | Out-Null
    Copy-Item (Join-Path $edmc 'package.json'), (Join-Path $edmc 'package-lock.json') -Destination $edmcTarget
    Copy-Item (Join-Path $edmc 'src'), (Join-Path $edmc 'public') -Destination $edmcTarget -Recurse
    Copy-Item (Join-Path $edmc 'node_modules') -Destination $edmcTarget -Recurse
    $runtimeFiles = @(
        'usr/local/bin/pflx-bitedj-supervisor',
        'usr/local/bin/start-pflx-edmc',
        'usr/local/sbin/pflx-update',
        'usr/local/sbin/pflx-rollback',
        'usr/local/sbin/pflx-usb-mount'
    )
    foreach ($relative in $runtimeFiles) {
        $source = Join-Path $pflxRoot ('layer/rootfs-overlay/' + $relative)
        $target = Join-Path $payload $relative
        New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
        # Windows checkout line endings must not break the Pi's interpreter.
        [IO.File]::WriteAllText($target, [IO.File]::ReadAllText($source).Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
    }
    $revision = git -C $projectRoot rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Cannot determine source revision' }
    $sourceChanges = git -C $projectRoot status --porcelain --untracked-files=normal
    if ($LASTEXITCODE -ne 0) { throw 'Cannot determine source worktree status' }
    $sourceDirty = [bool]$sourceChanges
    $binaryHash = (Get-FileHash -Algorithm SHA256 (Join-Path $payload 'usr/local/bin/mixxx')).Hash.ToLowerInvariant()
    $manifest = @('runtime=pflx-v2', ('created=' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')), "source_revision=$revision", "source_dirty=$($sourceDirty.ToString().ToLowerInvariant())", "binary_sha256=$binaryHash") -join "`n"
    [IO.File]::WriteAllText((Join-Path $staging 'manifest.txt'), $manifest + "`n", [Text.UTF8Encoding]::new($false))

    $output = Join-Path $OutputDirectory 'pflx-update.tar.gz'
    tar -czf $output -C $staging manifest.txt payload
    if ($LASTEXITCODE -ne 0) { throw 'Update archive creation failed' }
    $hash = (Get-FileHash -Algorithm SHA256 $output).Hash.ToLowerInvariant()
    Set-Content -Path ($output + '.sha256') -Value "$hash  pflx-update.tar.gz"
    $bootstrap = Join-Path $OutputDirectory 'apply-update.sh'
    [IO.File]::WriteAllText($bootstrap, [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'apply-update.sh')).Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
    Get-Item $output, ($output + '.sha256')
}
finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
