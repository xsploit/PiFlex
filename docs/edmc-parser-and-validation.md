# EDMC parsing, file validation and latency

The companion owns network/browser work; none runs in the real-time audio engine.

## Format handling

- Current EDMC header groups supply the catalog. Numeric genre IDs deduplicate slug aliases. The old IPS menu is an explicit compatibility path when the current grouped markup is absent.
- Actual page headings exclude the EDMC logo. File labels are taken from format text beside each iframe, including a preceding WAV paragraph when commentary shares the iframe paragraph.
- Clearly labelled MP3/FLAC/WAV options need only the release page. Unknown types get one bounded (12 second) BeatEXS metadata lookup each. The uploaded filename, not the MP3 preview URL, determines the hint. Metadata failure remains an explicit unknown option, not an invented type or a disabled valid download.
- Resolve results are cached for 15 minutes when resolve is requested again. Saved pre-v2 parser options/catalog are invalidated once; existing download metadata is retained.
- Actual downloaded bytes determine the final extension. MP3, FLAC and PCM/ADPCM WAV are supported. AAC/M4A, AIFF, Ogg and archives are not added by this change. A known unsupported option fails before fetching the download.

## Validation and runtime requirement

`ffprobe` (from the `ffmpeg` OS package) is now required for new downloads. New images include it. On older Pi images, install `ffmpeg` before deploying this update; the updated updater checks for ffprobe before replacing files or stopping services. Direct companion deployments fail a download clearly if the tool is missing, without stopping browsing.

Windows development also requires `ffprobe` on PATH. `BITEDJ_EDMC_FFPROBE` can select an explicit executable. Tests additionally require `ffmpeg` to encode generated one-second tone fixtures. DOM testing uses the pinned dev-only `linkedom` package.

The cheap signature filter is followed by bounded packet/container probing. Require a supported audio codec, packets, positive duration, sane sample rate and channel count. Reject malformed headers and AAC masquerading as MP3. Persist detected format, codec, sample rate, channels, duration and bitrate. This is **not** a complete decode or perceptual audio-quality test; later bitstream corruption and audible artifacts may still require decoder testing.

On Linux, ffprobe inherits an already-open audio-file descriptor. It must not reinterpret the companion's `/proc/self/fd` storage directory in the child process or reopen a replacement mountpoint.

Library inventory/drive selection remains a cheap size/signature check, not a full re-probe of every existing track. New downloads are fully probed before commit; a duplicate explicitly requested for reuse is also probed. Existing library entries have not all been retroactively certified. Rename/finalization checks avoid doing the full packet scan a second time.

## Latency and resource limits

- Two clearly labelled formats: one release navigation instead of a release plus two preview navigations. A warm resolve cache requires none.
- Preserve serialized jobs and closing headless Chromium after use to limit Pi resource contention.
- Download connection/header and body-idle timeouts default to 30 seconds. Body activity resets only the idle timer; audio probing has its own 30-second limit and cancellation signal.
- Progress events are throttled to at most approximately 5 per second, plus completion, instead of per network chunk.
- The browser's blocked external download host is not bypassed. These changes do not establish Internet throughput or Pi playback responsiveness.

## Verification

Run `npm ci` and `node --test` in `edmc-companion`. Tests cover current/legacy menus, duplicate genre IDs, multiple headings, mixed commentary/format labels, preview/source distinction, unknown metadata outages, resolve navigation counts/cache, migration, real encoded MP3/FLAC/WAV, malformed signatures, real AAC, stalled transfer cleanup, and Linux inherited file descriptors. Existing storage lifecycle tests remain part of the suite.

Live browser checks on 2026-09-04: current menu selector finds 15 groups / 137 unique genre IDs, including all 15 IDs missed by the legacy selector. The Cody Cordova dual-format release correctly reports MP3 and WAV with its actual title. No Pi deployment or live-host throughput claim is made.

Final local results: Node test runner reports 51 passing checks on Linux/WSL, and 49 passing / 2 Linux-only skips on Windows, with no failures (the count includes the fixture helper module discovered by Node). All 6 updater fixture tests pass, including refusing a missing ffprobe dependency before any service stop or installation change. Shell syntax and patch whitespace checks pass.

The original audit's header-only rejection tests were rerun against the new code; all malformed fixtures are now rejected. Results are retained in the outer workspace at `artifacts/edmc-sanity-20260904/fixtures-f0f8DZ/results.json`. Stronger probing adds work to finalization; the measured speed improvement claimed here is fewer resolve navigations, not faster raw transfer throughput.
