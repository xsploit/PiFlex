# BiteDJ integration plan

This document fixes the boundary between the companion and the current
`codex/pi-dev` BiteDJ fork. It deliberately postpones BiteDJ code changes until
the companion passes the physical Pi proof gates.

## What runs while mixing

The Node.js service stays available on `127.0.0.1:17642`, but Chromium does
not stay open. A user action creates one serialized job:

1. The companion starts system Chromium headless with the saved EDMC profile.
2. It reads one listing or resolves one provider link.
3. It closes Chromium as soon as the final media URL is known.
4. The media body streams directly to the selected USB at low I/O priority.
5. The completed file and USB index are committed atomically.

There is never more than one browser/download job. The service unit gives the
companion lower CPU and I/O weight than BiteDJ. No automatic crawling,
automatic downloading, or automatic track analysis happens during a set.

## First live workflow without changing BiteDJ

The proof UI selects the USB, signs in, browses the chosen subsection, and
queues a download. After completion the DJ returns to BiteDJ and opens:

```text
Computer
└── Removable Devices
    └── <selected USB>
        └── Music
            └── EDMC
                └── <subsection>
                    └── <track>.mp3
```

This uses `BrowseFeature` and `BrowseTableModel`, which already call
`TrackCollectionManager::getOrAddTrack(TrackRef)` when a file is loaded. It
therefore proves the real load path before a new library model is introduced.

## BiteDJ client slice

After the physical proof succeeds, add three C++ pieces:

### `EdmcClient`

A `QObject` using `QNetworkAccessManager` asynchronously on the UI thread. It
only talks to the loopback API. It owns request timeouts, JSON validation, job
polling, and service-unavailable states. It never parses EDMC HTML and never
launches Chromium itself.

### `EdmcFeature`

A `LibraryFeature` registered beside the existing `BrowseFeature`. Its sidebar
tree contains enabled subsections plus `Downloads`. Selecting a subsection
requests cached release rows from the companion. Selecting `Downloads` reads
the selected USB's `.bitedj/edmc/library.json` through the companion API.

The sidebar should disappear or show `Insert/select a USB` when no destination
is available. Eject handling must dismiss the model before its paths become
invalid, matching the fork's existing removable-device behavior.

### `EdmcReleaseModel`

A track-table-compatible model with rows for remote and downloaded releases.
Remote rows expose `Resolve` and `Download` actions but cannot be sent to a
deck. Downloaded rows contain the final local path. At that point the model
uses the existing `TrackCollectionManager::getOrAddTrack(TrackRef)` path and
emits the normal `LibraryFeature::loadTrack` or `loadTrackToPlayer` signal.

This preserves normal deck loading, controller LOAD buttons, metadata reading,
and the preview-deck machinery. The EDMC code does not invent a parallel audio
loader.

## User-facing state

The acquisition view needs explicit, finite states:

```text
Service offline
Sign-in required
Ready
Refreshing
Resolving provider
Queued
Downloading 0-100%
Ready on USB
Failed / Retry
```

A row becomes loadable only in `Ready on USB`. Removing the USB immediately
invalidates that state. A duplicate provider ID returns the already indexed
track rather than starting another transfer.

## Analysis policy

Downloading and analyzing are separate actions. For the first live version:

- Never start bulk analysis automatically.
- Let normal deck loading perform whatever minimum work BiteDJ already does.
- Offer `Analyze downloaded track` only after the transfer completes.
- Later, permit background analysis only when the user enables it and measured
  xrun/CPU tests show it is safe.

The companion never analyzes audio. Analysis remains owned by BiteDJ's
existing `AnalysisFeature` and worker machinery.

## API compatibility

The API is versioned at `/v1`. BiteDJ must first call `/v1/status` and refuse
unknown `apiVersion` values. Additive JSON fields are allowed; removing or
renaming fields requires `/v2`. This lets the proof UI and the compiled BiteDJ
client coexist while the companion evolves.

## Build order

1. Test the service, USB state, and queue locally.
2. Install Node.js, system Chromium, and the companion on Raspberry Pi OS.
3. Prove visible sign-in and headless reuse after reboot.
4. Prove one real USB download and existing BrowseFeature load.
5. Measure a refresh and download while BiteDJ is actively playing two decks.
6. Only then add `EdmcClient`, `EdmcFeature`, and `EdmcReleaseModel`.
7. Compile BiteDJ once after the client/model tests pass.
8. Add the broader `All Tracks on this USB` feature independently later.
