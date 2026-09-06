# BiteDJ — PiFlex edition

A touch-first Linux DJ application with customizable two-deck layouts,
Rekordbox USB analysis, DDJ-FLX6 controls, integrated EDMC downloads, and
live track metadata for streaming and visuals.

This is the [xsploit/BiteDJ fork](https://github.com/xsploit/bitedj), built on
[Team Deckshark's BiteDJ](https://github.com/TeamDeckshark/bitedj) and
[Mixxx](https://mixxx.org/). It contains the application source, skins,
controller mappings, and optional EDMC companion. **You can build the app
without building or flashing an OS image.**

For the optional Raspberry Pi appliance image, kernel tuning, kiosk services,
and recovery tools, see the separate [PiFlex OS guide](os/README.md).

Upstream credits: [Team Deckshark](https://github.com/TeamDeckshark) ·
[Alyxx](https://github.com/alyxxxinteractive) ·
[BiteDJ source](https://github.com/TeamDeckshark/bitedj).
The original engine, touch interface, and upstream contributions retain their
credits and licenses. This README describes this fork, not upstream feature parity.

## Platform

The application targets **Linux with Qt 6**. Native Windows and macOS builds
are not supported by this fork. Pi appliance controls such as system recovery,
power management, and the Wayland touch keyboard need their supporting runtime;
they are not installed just by compiling the application.

The current development target is:

- Raspberry Pi 5 (4 GB)
- Official [Raspberry Pi Touch Display 2](https://www.raspberrypi.com/products/touch-display-2/)
  (10-inch model, configured as 1920x1200 landscape)
- Pioneer DDJ-FLX6
- USB media exported by Rekordbox

## Features

This fork extends BiteDJ with customizable touch layouts, FLX6 workflows,
Rekordbox prepared analysis, EDMC downloads, and live-stream controls.
The inventory below covers the current source; see [Release status](#release-status)
for verification and deployment requirements.

Recent additions include **fader-safe track replacement**, return to Play after
loading, searchable All Tracks with an on-screen keyboard, accelerated browsing,
hold-to-repeat grid edits, **Rekordbox-first analysis**, cue/phrase alignment,
and independently switchable audio broadcasting and track metadata. Details and
recorded checks are in [live workflow and metadata](docs/live-workflow.md).

Jump to: [Display](#display-skins-and-waveform-layout) ·
[FX/key/grid](#fx-key-and-beatgrid-controls) ·
[FLX6](#flx6-mapping-and-jog-response) ·
[Library](#library-prepare-and-browsing-responsiveness) ·
[EDMC](#edmc-browsing-search-downloads-and-file-validation) ·
[USB/SD](#multiple-usbs-sd-fallback-and-safe-eject) ·
[Rekordbox](#rekordbox-prepared-analysis-details) ·
[Streaming/metadata](#audio-broadcasting-and-live-track-metadata) ·
[Inherited features](#retained-upstream-features-available-in-this-build) ·
[Build](#build-and-install).

### Display, skins, and waveform layout

- Independent **PiFlex / XDJ / Pioneer main-view layouts** and **visual themes**.
- **Day and Night** lighting with theme-aware colors and readable setting labels.
- **Display reset** restores the display controls to their defaults.
- Persisted **library font sizing**, with touch-accessible increase/decrease.
- **Full-width deck waveforms** instead of the side panel consuming that space.
- Enlarged whole-track preview: an **80-pixel visible waveform area**, using
  the upper half of a 160-pixel source widget in the default skin.
- A separate **18-pixel phrase row** below that preview, keeping phrase labels
  outside the waveform clip rather than shrinking the preview to fit them.
- Enlarged **180-pixel cue/deck drawer budget** in the default skin.
- **RGB / Filt / Stack** waveform modes.
- **Fixed / EQ** waveform response selection.
- **Slim / PiFlex / Bold** waveform visual-gain presets.
- **Wide / PiFlex / Near** scrolling-waveform zoom presets.
- **Linked zoom** for both decks.
- A shared **time-based scrolling scale** for native Mixxx and imported
  Rekordbox waveforms. Their different analysis densities no longer produce
  different scroll speeds or beat spacing at the same tempo and zoom.
- Matching low/mid/high frequency colors in the overview and scrolling views
  (blue/orange/cream in **Filt** mode), without changing analysis or audio gain.
- Long **track titles and artist names scroll** within their existing space,
  pause at either end, and stop animating when hidden or when the text fits.
- Tap a deck's **Play-view time readout** to switch elapsed/remaining independently of the
  other deck. Each deck's choice is saved; remaining time is the initial default.
  The compact overview countdown in other views remains a remaining-time overlay.
- Stable scrolling-waveform height when changing **channel trim**; audio trim
  still changes the sound, while the visualization retains its comparison scale.
- Migration of stale user skin overrides during updates, so an old local skin
  does not hide the newly installed interface.

Sources: [display settings](res/skins/BiteDJ/settings.xml) and
[BiteDJ skin](res/skins/BiteDJ/).
Selected presentation ideas were adapted from
[Pioneered by ntamas](https://github.com/ntamas94/pioneered-by-ntamas/).
See the [integration notes](docs/PIONEERED-INTEGRATION.md) for the deliberately
limited scope; this does not replace PiFlex's analyzer or enable a four-deck view.

### FX, key, and beatgrid controls

- An overview side panel with separate **FX, Key, Wave, and Grid** pages.
- Touch-sized effect selection: widened popup, full effect names, larger rows,
  and scrolling without the gesture handler swallowing effect-selection taps.
- FX deck assignment, wet/dry mix, enable/disable, and exposed parameter controls.
- **Beat FX period selection** linked to the controller's Beat left/right buttons:
  1/8, 1/4, 1/2, 1, 2, and 4 beats where the selected parameter supports them.
- **Key page:** per-deck key readout, two-semitone up/down controls, harmonic
  Match, and reset to the file key, using BiteDJ/Mixxx's key controls.
- **Wave page:** linked zoom Out, Reset, and In controls.
- **Grid page:** per-deck shift-earlier, set-grid-at-current-position,
  shift-later, BPM slower, and BPM faster controls.
- Larger grid and BPM buttons repeat after **350 ms held**, then every **80 ms**;
  Set remains a single action rather than repeating.

Sources: [overview panels](res/skins/BiteDJ/effects.xml),
[beatgrid controls](res/skins/BiteDJ/templates/grid_deck_row.xml),
[key controls](res/skins/BiteDJ/templates/keyfx_deck_row.xml), and
[touch effect selector](src/widget/weffectselector.cpp).

### FLX6 mapping and jog response

- DDJ-FLX6 mapping adapted from the credited community profiles, with mixer,
  faders, EQ, filter, gain, headphone cue, transport, jog, looping, tempo range,
  sync, and pad-mode bindings.
- **VIEW opens Browse**; **BACK** opens Browse from other pages, then navigates
  backward within the active library/EDMC view.
- Browse encoder navigation and activation no longer depend on whichever Qt
  widget last received touch focus; track-table roots open their track view.
- Encoder navigation also covers the EDMC format picker.
- **Shift + Browse zooms both decks together**.
- **Jog release resumes playback immediately** when the deck was playing before
  touch, without the old scratch-release ramp leaving it apparently stopped.
- **Shift + jog adjusts beatgrid alignment**, replacing fast search without
  seeking playback or enabling scratch. Shift + Browse remains linked zoom.
- Optional **accelerated browsing** gives larger steps when the browse encoder
  turns quickly; slow turns, direction changes and sidebar navigation stay precise.
- Configurable **jog-wheel smoothing/filter length** in the service preferences,
  persisted as `JogWheelFilterLength` (default 6, bounded to 1-64).
- Rotary-filter state handling fixes and a dedicated regression test.
- Beat FX next/previous selection, shorter/longer period, focused effect toggle,
  and Shift + ON/OFF disabling all three effect slots.
- **Rekordbox 6.7-style Pad FX bank**: eight pads plus eight Shift pads on all
  four decks, using private native-effect lanes rather than numbered user
  presets. Echo/reverb retain release tails; Release Echo gates its own dry
  signal without changing the channel fader. Same-effect holds restore the
  earlier held pad when the newer one is released. Sound/transport voicing is
  approximate, not Rekordbox DSP. Local controller and Echo DSP tests pass;
  Pi performance and physical-pad listening checks are still required.
  See [Pad FX implementation and validation](docs/pad-fx.md).
- **Pad FX settings editor**: per-deck normal/Shift assignments, an Off slot,
  bounded Echo/delay beat overrides, five native-strength levels, momentary or
  toggle Release Echo, selected-pad reset, and an all-deck Pad FX stop. Choices
  are saved separately from user effect-rack presets. Held pads keep their
  original assignment until released; track unload clears latched effects.
  Transport effects stay momentary. See the [Rekordbox-to-BiteDJ system map](docs/rekordbox-system-map.md)
  for verified behavior, deliberate differences, and remaining validation.

Sources: [FLX6 script](res/controllers/Pioneer-DDJ-FLX6-script.js),
[library controller routing](src/library/librarycontrol.cpp),
[jog response](src/engine/controls/ratecontrol.cpp), and
[rotary tests](src/test/rotary_test.cpp).

### Library, Prepare, and browsing responsiveness

- **All Tracks** is exposed as a source and combines local and Rekordbox tracks.
- **Prepare** provides a dedicated preparation list, selected-track membership
  toggle, and a controller action to open it directly.
- Prepare supports track drops, avoids adding already-present tracks, and keeps
  its hidden local playlist across clean restarts without rewriting USB playlists.
- Drag browser column headings to reorder them; order is saved per library model.
  Column visibility and relative widths remain controlled by the existing
  settings, alongside PiFlex's text-size persistence changes.
- Sorting by BPM retains the selected track and scrolls to its sorted position,
  keeping a selected 140 BPM track among the other 140 BPM tracks. This sorts
  the current results; it does not restrict the list to an exact-BPM filter.
- **Track Replace: Lock / Fader / Stop / Live** in General settings:
  Lock protects a playing deck; Fader permits replacement only with its channel
  fader down or main-mix routing off; Stop replaces and stops; Live replaces and
  plays. Fader is the default for fresh configurations; existing choices remain.
  The safety check uses routing, not silence during a breakdown, and rejects
  unknown control state. External mixer routing and headphone audibility are
  outside this check.
- Successful main-deck loading **returns to Play** by default, with an opt-out
  in Stream settings. Failed loads do not trigger that navigation.
- **All Tracks search**, including Rekordbox tracks, with compact, centered,
  font-aware BPM and key columns and adjustable width weights.
- **Touch keyboard: auto/off** for editable search, text, password, and numeric
  fields on the Pi Wayland session using the installed `wvkbd-mobintl` keyboard.
  Focus handling is event-driven; hidden, disabled, and read-only fields do not
  launch it. The switch is in Stream settings.
- Enter/Return stays in search, including repeated presses, rather than moving
  focus to the results and accidentally loading a track.
- Portable USB play-history writes use a **serialized background worker**,
  preserving their order and the current browser selection while keeping the
  SQLite write off the GUI thread.
- External track and playlist models use **location-to-track-ID lookups** instead
  of repeatedly scanning every row for loaded-track identity.
- Rekordbox tracks may share an analysis path without being rejected by a
  unique-analysis-path constraint; audio locations remain their track identity.
- Failed track inserts and playlist references without a valid track are skipped
  instead of inserting broken local playlist references.

Sources: [library](src/library/library.cpp),
[Prepare](src/library/trackset/preparefeature.cpp),
[portable history](src/library/trackset/setlogfeature.cpp), and
[Rekordbox reader](src/library/rekordbox/rekordboxfeature.cpp).

### EDMC browsing, search, downloads, and file validation

- Native BiteDJ EDMC screens backed by a separate **Node.js/Playwright companion**.
- Sign-in through system Chromium with a dedicated persisted browser profile;
  later jobs reuse the profile and serialize browser work.
- Grouped genre/category navigation, release browsing, and **EDMC Music search**
  from BiteDJ (minimum two characters).
- Release format selection, queued jobs, progress/status, and cancellation.
- **Load and Preview** completed downloads through BiteDJ's local-track path.
- Download destinations: **Music/EDMC, Downloads, USB/EDMC, or Custom**.
- **Flat or By Genre** folders; **Manual or Auto Add** to All Tracks.
- Setup UI for selecting the destination and managed SD fallback policy.
- Updated genre parser deduplicates numeric genre IDs and handles
  grouped navigation; release titles are separated from unrelated page headings.
- MP3/WAV/FLAC file labels are parsed independently of commentary and previews.
- Known labels avoid unnecessary preview navigation; unknown types use bounded
  metadata lookup. Repeated resolution uses a **15-minute cache**.
- Parser-cache migration refreshes old format information without deleting music.
- **Signature plus ffprobe validation** determines supported downloaded audio;
  missing probing tools cause a clear failure, not a signature-only success.
- Rejection of malformed/signature-only audio, AAC disguised as MP3, and
  detectable truncated WAV payloads; this is not a full decode of every sample.
- Connection/header and body-idle timeouts; throttled progress notifications.
- Partial-file cleanup, SHA-256 recording, synchronized finalization, and atomic
  library metadata replacement with last-valid-generation recovery.
- Cheap inventory reconciliation, with full validation for a newly completed
  download or explicitly reused duplicate, avoids probing the whole library.

### Multiple USBs, SD fallback, and safe eject

- Enumerates mounted block filesystems rather than treating any writable
  directory as an inserted USB.
- Tracks filesystem UUID and mount-instance identity so a reused label/path
  does not silently become the previously selected drive.
- A missing remembered USB does not prevent the companion from starting.
- **Explicit SD fallback**, enabled by default and identified in setup/status,
  applies to new jobs. Reinsertion restores the remembered USB for later jobs.
- Each active download pins its original Linux destination through a directory
  descriptor; unplugging cannot redirect writes into the uncovered mountpoint.
- No automatic migration of partial downloads between USB and SD.
- Destination selection is validated before being committed; switching is
  rejected while downloads are queued/running.
- Separate USB identities and download provenance preserve Load/Preview when
  selecting another drive; duplicate-download reconciliation restores that state.
- A **256 MiB free-space reserve**, known-size preflight, and streaming rechecks.
- Settings eject coordinates with the companion to cancel/release active work
  before the existing unload/save/unmount sequence; a failed eject is reported
  and can be retried, without force/lazy unmount.
- Bounded native HTTP waits: **five seconds for eject coordination**, ten seconds
  for general EDMC requests.

Sources and test details: [companion](edmc-companion/README.md),
[parser/audio checks](docs/edmc-parser-and-validation.md), and
[storage/eject checks](docs/storage-reliability.md).

### Rekordbox prepared-analysis details

- Traditional Device Library discovery at `PIONEER/rekordbox/export.pdb`,
  including the hidden `.PIONEER` variant; tracks, playlists, and metadata feed
  the existing reader and the combined All Tracks view.
- **32-bit page indices**, out-of-file checks, and cycle detection in database
  traversal, instead of truncating large page indices.
- **DAT beatgrids** and **EXT-preferred cues/loops**, with both beat and cue
  passes for DAT-only exports. Missing/corrupt analysis reports a warning.
- Local cue/rating overrides are applied after source analysis import.
- **PWV6/PWV7 three-band overview and scrolling waveforms from `.2EX`**.
- Validates a complete overview/detail pair before replacing existing display
  data; missing/invalid pairs retain the existing display or allow native analysis.
- Preserves the detailed **150 Hz timebase**, band relationships, silence, and
  timing offset. Shared-peak normalization per envelope fixes the tiny imported
  waveform height without changing audio amplitude or pumping gain per window.
- **PSSI phrase analysis**, including masked/unmasked data, labels/colors,
  variable-tempo beat-to-time conversion, and source timing offsets.
- Analysis preference: **Rekordbox first** (default) imports available grids,
  keys, phrases and supported waveforms; enabled native analyzers fill missing
  data. **BiteDJ only** retains exported cues but uses native grid/key/waveforms.
  Switches apply after unloading/reloading, never to a currently loaded deck.
  Locked grids stay protected; native phrase detection is not implemented.
- Cue badges overlay the top of the scrolling waveform, independently of the
  phrase timeline. Phrase display follows beatgrid edits from an immutable
  source grid, so nudges/undo do not accumulate timing drift.
- Opaque phrase row below the full-track overview; lower translucent phrase
  overlay on the scrolling waveform, with optional fill indication there.
- QPainter and OpenGL drawing paths, with cached GL label textures and clipping
  for scrolling/seek behavior.
- Phrases are **read-only, session-local metadata**: they do not consume cue
  slots or rewrite the exported USB database/audio tags. Missing phrases are
  not invented, and invalid optional fills can be omitted without losing the
  remaining valid phrase boundaries.
- Real-export metadata and path audit tools plus parser, waveform allocation,
  timing, drawing, and release-flag floating-point regression fixtures.

Compatibility covers **traditional Rekordbox USB exports and their available
analysis**. OneLibrary/Device Library Plus-only exports, desktop `master.db`,
guest player settings, and playlist/cue write-back are not supported. Layouts
and rendering are PiFlex presentations, not Pioneer firmware emulation.

See [Rekordbox read compatibility](docs/rekordbox-read-compatibility.md)
for format coverage and test commands.

### Audio broadcasting and live track metadata

**Settings > Stream** separates the audio broadcast connection from the metadata
server. Either can run independently; metadata is off on every application launch.

- **Audio Start/Stop** controls the Icecast/Shoutcast broadcaster. Connection
  settings exposes profiles, host, port, mount, credentials, codec, bitrate,
  and reconnection controls. This connects to an existing streaming server;
  it does not install Icecast, launch VLC, or configure OBS.
- **Metadata Start/Stop** controls a read-only HTTP server on port **8794**.
  Local-only is the default; **Share with LAN** is an explicit choice.
- `GET /v1/state` returns a JSON snapshot. `GET /v1/events` provides
  Server-Sent Events, starting with a snapshot and publishing named `state` events.
- Per-deck data includes loaded/playing state, title, artist, key, BPM, playback
  rate, duration, position, channel fader, and main-mix routing.
- **On-air candidates** identify loaded, playing decks with an open channel
  fader and main-mix routing enabled. Both decks can be candidates during a mix.
  This does not measure the crossfader, master gain, external mixer, or actual
  audio content, so it is not a guarantee that a deck is audible.
- Control changes drive coalesced updates, at most **10 per second**, without
  library polling or additional analysis. No subscribers means no change-driven
  snapshot building/serialization; stopping closes clients and publishing timers.
- Bounded requests/output, an eight-client limit, and subscribed keepalives.
  Position is a snapshot, **not a sample-accurate beat or phase clock**.

Unity visuals and OBS integrations can consume this API; it does not automatically
wire existing plugins into it. LAN sharing is unauthenticated and intended for a
trusted local network. See the [metadata contract and settings guide](docs/live-workflow.md)
for fields, limits, and integration boundaries.

### Retained upstream features available in this build

BiteDJ and Mixxx provide the core DJ capabilities:

- Hot cues and memory cues, loops, quantize, sync, keylock, and sampler machinery.
- Mixer/EQ/isolator modes, CFX Filter, Beat FX, and remembered effect parameters.
- Master, booth, and headphone level controls and USB recording.
- Vinyl/CDJ jog mode, gated/ungated hot cues, vinyl-brake choices, deck routing,
  key notation, and played-state controls.
- Audio/MIDI device selection with staged Apply/Cancel, rescanning, and
  Latency/Quality audio presets in the touch settings.
- USB-resident cue, metadata/rating, analysis, sampler-bank, and history stores;
  source-specific library support including traditional Rekordbox and Serato.
- Cache/cue/metadata clearing, missing/played-track indications, screen rotation,
  shutdown confirmation, and touchscreen notifications.

The [upstream feature description](docs/BITEDJ-UPSTREAM.md) is preserved for
attribution and background; where PiFlex changes behavior, this inventory and
the current source take precedence over that historical description.

## Release status

This fork is in **active development**. The latest documented application
installation on the development Pi is **September 6, 2026**, following a complete
ARM64 Release build. A standalone application installer is not yet published;
cloning this repository retrieves source, not an installed DJ system.

Recorded validation includes:

- Native Qt fixtures for loading policy, workflow widgets, metadata transport,
  search submission, touch keyboard, cue placement, and phrase/grid projection,
  plus controller-script regressions.
- Live checks of All Tracks search and repeated Enter without accidental loading,
  return-to-Play loading, keyboard visibility, analysis-policy toggles, and
  the metadata listener's local/LAN/start/stop behavior.
- Earlier Rekordbox parser, waveform/time-scale, phrase-layout/drawing, EDMC
  parser/audio-validation, and storage tests. The September 4 companion run
  recorded 51 Node checks on Linux/WSL (including a discovered fixture helper),
  and 49 passes with two Linux-only skips on Windows.

These are dated results, not a claim that every current configuration has been
tested. See [live workflow](docs/live-workflow.md) and
[presentation integration](docs/PIONEERED-INTEGRATION.md) for evidence and limits.

Release qualification still requires physical FLX6 Browse/format-picker and inherited pad-mode
checks, multi-drive disconnect/eject testing, and a 30-minute two-deck run with
measured zero xruns under simultaneous display, analysis, and download load.
Local regression results do not establish live transfer speed or audio stability.

Validation procedures: [Rekordbox](docs/rekordbox-read-compatibility.md),
[storage and updates](docs/storage-reliability.md), and
[EDMC parsing and latency](docs/edmc-parser-and-validation.md).

## Repository layout

- `src/` contains the C++/Qt application, audio engine, analysis, and library code.
- `res/skins/BiteDJ/` contains the touch interface, themes, and layout templates.
- `res/controllers/Pioneer-DDJ-FLX6*` contains the current FLX6 profile.
- `src/library/edmc/` contains BiteDJ's asynchronous EDMC client UI.
- `edmc-companion/` contains the Node.js/Playwright acquisition service. Browser,
  network, and download work stay outside the real-time audio process.
- `docs/BITEDJ-UPSTREAM.md` preserves BiteDJ's upstream project description.
- `src/test/` and `os/tests/` contain native and focused regression fixtures;
  many app tests retain their historical location under `os/tests/`.
- `os/` contains the optional Pi appliance image, deployment, runtime, and
  recovery integration. It is not required to build an application binary.

## Build and install

### Linux application

Use this repository as the source tree, not an unmodified upstream checkout.
The build uses **CMake 3.21+**, a C++ compiler, Qt 6, and the audio/codec
development dependencies listed in the repository's build-environment scripts.

```sh
git clone https://github.com/xsploit/bitedj.git
cd bitedj

# Debian/Ubuntu: review the script first; it installs system build dependencies.
bash tools/debian_buildenv.sh setup

cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DQT6=ON \
  -DBROADCAST=ON -DFFMPEG=ON -DDOWNLOAD_MANUAL=OFF
cmake --build build --parallel 2
sudo cmake --install build
```

Dependency availability varies by distribution. The
[Arch helper](tools/arch_buildenv.sh) and [CI configuration](.github/workflows/tests.yml)
provide additional dependency/build references. The commands above describe
the build entry points; they are not a newly verified clean-machine installation.
Adjust parallelism for available RAM, especially on a 4 GB Pi. To target ARM64,
build on ARM64 Linux or supply a suitable cross-compilation toolchain; a normal
x86 Linux build does not produce a Pi binary.

WSL is blocked by default. `-DALLOW_WSL_BUILD=ON` permits development builds,
but WSL audio/USB behavior is not production qualification. Installing the app
does not configure audio routing, USB permissions, a kiosk, or service supervision.
For those Pi-specific pieces and application deployment, use the
[PiFlex OS/runtime guide](os/README.md).

### Optional EDMC companion

EDMC downloads use a separate service; ordinary playback does not require it.
The companion requires **Node.js 20+**, system Chromium, and **ffmpeg**
(which supplies `ffprobe`):

```sh
cd edmc-companion
npm ci
npm test
```

Follow the [companion setup guide](edmc-companion/README.md) for startup,
browser authentication, storage selection, and the native app connection.
It does not ship an authenticated session. Browser, network, and download work
remain outside the real-time audio process.

### Focused regression checks

From the repository root:

```sh
node os/tests/test_flx6_workflow.cjs
python3 os/tests/test_deck_load_policy.py
python3 os/tests/test_live_metadata.py
python3 os/tests/test_search_submit.py
python3 os/tests/test_phrase_alignment.py
python3 os/tests/test_cue_phrase_layout.py
python3 os/tests/test_touch_keyboard.py
```

Native fixtures require Linux development dependencies, Qt 6, and a C++ compiler.
The [workflow guide](docs/live-workflow.md) lists related checks; full native
suite configuration is in [CI](.github/workflows/tests.yml). Tests do not
replace real controller, removable-drive, or sustained audio-load checks.

## Legal and upstream attribution

This repository does not contain music, account credentials, cookies, or a preconfigured
EDMC session. Users are responsible for complying with service terms and only
downloading material they are authorized to access.

BiteDJ and Mixxx source remain licensed under GPL-2.0-or-later. Component and
skin licenses remain alongside their source. See [`LICENSE`](LICENSE),
[`COPYING`](COPYING), and [`NOTICE.md`](NOTICE.md).
