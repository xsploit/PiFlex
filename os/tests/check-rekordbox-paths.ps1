param(
    [Parameter(Mandatory)][string]$Report,
    [Parameter(Mandatory)][string]$DriveRoot
)
$ErrorActionPreference = 'Stop'
$audit = Get-Content -LiteralPath $Report -Raw | ConvertFrom-Json
$root = [IO.Path]::GetFullPath($DriveRoot).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
$missingAudio = @(); $emptyAudio = @(); $unsafePaths = @(); $missingAnalysis = @()
$datOnly = @(); $noBeats = @(); $hotCues = 0; $memoryCues = 0; $loops = 0
$analysis = @{}
foreach ($item in $audit.analysis) { $analysis[$item.path.Replace('\','/')] = $item }
foreach ($track in $audit.tracks) {
    $path = [IO.Path]::GetFullPath((Join-Path $root $track.file.TrimStart('\','/')))
    if (-not $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        $unsafePaths += $track.id; continue
    }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $missingAudio += $track.file }
    elseif ((Get-Item -LiteralPath $path).Length -eq 0) { $emptyAudio += $track.file }
    $dat = $track.analysis.Replace('\','/').TrimStart('/')
    if (-not $dat -or -not $analysis.ContainsKey($dat)) { $missingAnalysis += $track.id; continue }
    if ($analysis[$dat].beats -eq 0) { $noBeats += $track.id }
    $ext = [IO.Path]::ChangeExtension($dat, 'EXT').Replace('\','/')
    if ($analysis.ContainsKey($ext)) { $cues = $analysis[$ext] }
    else { $datOnly += $track.id; $cues = $analysis[$dat] }
    $hotCues += $cues.hotCues; $memoryCues += $cues.memoryCues; $loops += $cues.loops
}
$trackIds = @{}; foreach ($track in $audit.tracks) { $trackIds[[string]$track.id] = $true }
$playlistIds = @{}; foreach ($playlist in $audit.playlists) { $playlistIds[[string]$playlist.id] = $true }
$badEntries = @($audit.entries | Where-Object { -not $trackIds.ContainsKey([string]$_.track) -or -not $playlistIds.ContainsKey([string]$_.playlist) })
$badParents = @($audit.playlists | Where-Object { $_.parent -ne 0 -and -not $playlistIds.ContainsKey([string]$_.parent) })
[ordered]@{
    tracks = @($audit.tracks).Count
    playlists = @($audit.playlists | Where-Object { -not $_.folder }).Count
    folders = @($audit.playlists | Where-Object folder).Count
    playlistEntries = @($audit.entries).Count
    duplicateTrackIds = @($audit.tracks | Group-Object id | Where-Object Count -gt 1).Count
    missingAudio = $missingAudio; emptyAudio = $emptyAudio; unsafePaths = $unsafePaths
    missingAnalysis = $missingAnalysis; datOnlyTrackIds = $datOnly; tracksWithoutBeatgrid = $noBeats
    brokenPlaylistEntries = $badEntries; brokenPlaylistParents = $badParents
    preferredAnalysisHotCues = $hotCues; preferredAnalysisMemoryCues = $memoryCues; preferredAnalysisLoops = $loops
    fileTypes = @($audit.tracks | Group-Object { [IO.Path]::GetExtension($_.file) } | Select-Object Name,Count)
} | ConvertTo-Json -Depth 8
