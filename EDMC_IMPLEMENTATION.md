# EDMC implementation

## Verified site flow

The following behavior was verified against a signed-in EDMC session on
2026-08-29:

- Sections and subsections have stable URLs such as
  `https://edmc.to/genre/drum-bass-37/` and use `?page=N` pagination.
- Release topics have stable numeric IDs in URLs such as
  `/music/blank-canvas-char-call-me-708681/`.
- A release post contains one or more BeatEXS players with URLs shaped like
  `https://beatexs.com/embed/<id>`.
- The BeatEXS embed exposes an MP3 preview source and links to
  `https://beatexs.com/<id>` for the download flow.
- EDMC returns a not-found page for these listings when the request is not
  authenticated. The implementation therefore needs a browser-backed,
  persistent login session.

## Scope

The importer subscribes only to sections or subsections selected by the user.
It never crawls the complete EDMC music catalog. A refresh reads the first page
of each subscription and stops as soon as it reaches a known topic ID. Older
pages are only visited during an explicit initial backfill.

Examples of useful subscriptions include Drum & Bass, Jump-Up, Jungle/Ragga,
Neurofunk/Dark, Dubstep, Deep Dubstep, and Riddim.

Verified subsection URLs include:

- `https://edmc.to/genre/jump-up-145/`
- `https://edmc.to/genre/jungleragga-122/`
- `https://edmc.to/genre/neurofunkdark-164/`
- `https://edmc.to/genre/deeptechstep-176/`
- `https://edmc.to/genre/riddim-177/`
- `https://edmc.to/genre/deep-dubstep-103/`

## Runtime design

EDMC runs as an on-demand companion process instead of linking a web engine
into the real-time DJ process. Closing the importer releases its browser and
memory before a set.

The companion owns:

1. A persistent browser profile used only for EDMC and BeatEXS login state.
2. The selectable subsection list and per-subsection newest-seen topic ID.
3. A release list containing title, topic URL, provider IDs, preview state,
   download state, and local destination.
4. A download queue that writes to a temporary name and atomically renames a
   file into the watched inbox only after completion.
5. Duplicate detection based on provider ID, normalized filename, size, and a
   final file hash.

The BiteDJ side owns:

1. A watched inbox on internal storage or a selected USB drive.
2. Importing a completed file into the library.
3. Scheduling waveform, BPM, beatgrid, key, and loudness analysis away from
   the audio thread.
4. Displaying import/analysis progress and making the track loadable without
   restarting BiteDJ.

## Delivery slices

1. Tested HTML parsing for EDMC topics and BeatEXS provider/preview IDs.
2. On-demand browser with persistent login and subsection subscriptions.
3. Preview and one-track download into a watched inbox.
4. Incremental refresh, duplicate detection, progress, cancellation, and
   recovery after interruption.
5. BiteDJ library notification and background analysis.
