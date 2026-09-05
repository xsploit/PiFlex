# PiFlex OS

PiFlex OS is a custom, performance-focused Raspberry Pi operating-system image
for standalone DJ hardware. It boots directly into a touch-first DJ interface
with integrated audio, controller support, USB libraries, downloads, networking,
and system recovery.

[BiteDJ](https://github.com/TeamDeckshark/bitedj), itself based on
[Mixxx](https://mixxx.org/), provides the DJ engine. This repository includes
the PiFlex OS image recipe, runtime services, customized BiteDJ application,
and EDMC download companion.

Upstream credits: [Team Deckshark](https://github.com/TeamDeckshark) ·
[Alyxx](https://github.com/alyxxxinteractive) ·
[BiteDJ source](https://github.com/TeamDeckshark/bitedj).
Thank you for the upstream work that PiFlex builds on.

## Hardware

The current development target is:

- Raspberry Pi 5 (4 GB)
- Official [Raspberry Pi Touch Display 2](https://www.raspberrypi.com/products/touch-display-2/)
  (10-inch model, configured as 1920x1200 landscape)
- Pioneer DDJ-FLX6
- USB media exported by Rekordbox

## Features

PiFlex extends BiteDJ with customizable touch layouts, FLX6 workflows,
Rekordbox prepared analysis, EDMC downloads, and appliance management.
The inventory below covers the current source; see [Release status](#release-status)
for verification and deployment requirements.

Jump to: [Display](#display-skins-and-waveform-layout) ·
[FX/key/grid](#fx-key-and-beatgrid-controls) ·
[FLX6](#flx6-mapping-and-jog-response) ·
[Library](#library-prepare-and-browsing-responsiveness) ·
[EDMC](#edmc-browsing-search-downloads-and-file-validation) ·
[USB/SD](#multiple-usbs-sd-fallback-and-safe-eject) ·
[Rekordbox](#rekordbox-prepared-analysis-details) ·
[OS/recovery](#os-integration-deployment-and-recovery-additions) ·
[Inherited features](#retained-upstream-features-available-in-this-build).

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
- Matching low/mid/high frequency colors in the overview and scrolling views
  (blue/orange/cream in **Filt** mode), without changing analysis or audio gain.
- Long **track titles and artist names scroll** within their existing space,
  pause at either end, and stop animating when hidden or when the text fits.
- Tap a deck's **time readout** to switch elapsed/remaining independently of the
  other deck. Each deck's choice is saved; remaining time is the initial default.
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
- **Shift + jog search avoids simultaneously enabling scratch**, preventing
  a seek from leaving the deck held by the scratch engine.
- Configurable **jog-wheel smoothing/filter length** in the service preferences,
  persisted as `JogWheelFilterLength` (default 6, bounded to 1-64).
- Rotary-filter state handling fixes and a dedicated regression test.
- Beat FX next/previous selection, shorter/longer period, focused effect toggle,
  and Shift + ON/OFF disabling all three effect slots.

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
- Configurable library columns and relative widths, retaining the upstream
  column controls alongside PiFlex's text-size persistence changes.
- **Lock / Stop / Live** deck-load policies are exposed in the touch settings.
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

### OS integration, deployment, and recovery additions

- **Debian 13 arm64 `minbase`** with a minimal Sway/Wayland kiosk, Xwayland
  disabled, and direct ALSA without PulseAudio or PipeWire.
- Display/touch configuration, Ethernet, Wi-Fi, SSH, mDNS, removable-media
  automount, and first-boot filesystem expansion.
- Pi GPU/DSI renderer selection in the Wayland launcher.
- CPU isolation requests **CPU 3 for audio** and **CPU 2 for controller work**.
  USB-host IRQ tuning targets CPU 2, with real-time priority when the kernel
  exposes threaded IRQs. The session has real-time and locked-memory limits;
  the GUI and Qt rendering workers retain normal scheduling.
- Background caching and EDMC/Chromium work use **CPUs 0-1**. The companion
  runs with low CPU/idle I/O priority and memory-pressure controls, outside
  the real-time audio process.
- Performance CPU governor, swap disabled at startup, and unattended package
  and unnecessary maintenance timers disabled.
- Persistent system journal capped at **64 MiB with seven-day retention**.
- **Restart BiteDJ** from Settings, with an explicit requested-restart exit path
  that does not count as a crash; a single-supervisor lock avoids duplicates.
- Recovery terminal after repeated exits, with keyboard shortcuts for restart,
  terminal, and on-screen keyboard while networking remains available.
- `pflx-diagnostics` reports kernel, scheduling, audio devices, USB, mounts,
  temperature/throttling where available, and recent service logs.
- Application update packaging without reflashing, with revision/dirty-state
  metadata and a separate executable hash; packaging does not rebuild the app.
- Windows-generated archive compatibility and an **update bootstrap** for older
  installed updaters.
- Update payload includes the supervisor, companion launcher, mount helper,
  updater, and rollback helper as well as application/resources/EDMC.
- Checked payload paths/checksums, serialized updates, verified rollback backups
  before replacement, restoration on install failure, and stopped services if
  restoration fails. Legacy unverified backups are rejected by v2 rollback.
- Source-staging helper with baseline/conflict checks and verified Pi backups;
  staging is separate from installation or restarting the application.
- Native parser, waveform, phrase, drawing, storage, updater, and source-compile
  checks plus read-only export/path audit tools under `os/tests/`.

Configuration: [image customization](os/scripts/customize-rootfs.sh),
[session service](os/layer/rootfs-overlay/etc/systemd/system/pflx-session.service),
[runtime tuning](os/layer/rootfs-overlay/usr/local/sbin/pflx-tune), and
[companion service](os/layer/rootfs-overlay/etc/systemd/system/pflx-edmc.service).

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

PiFlex OS is a **development release** targeting the hardware listed above.
PREEMPT_RT is enabled on the development system; kernel selection is configurable
for new image builds. Other controllers, displays, and Pi boards are not yet
qualified, and a stable end-user image/update channel is not yet available.

Verification recorded September 4, 2026:

- **51 Node checks passed on Linux/WSL**, including a discovered fixture helper.
  Windows passed 49 with two Linux-only skips.
- **Six updater tests passed**, along with native storage, Rekordbox parser,
  waveform, phrase-layout, and drawing fixtures.
- **Eight C++ translation units passed syntax checks**.
- The presentation adaptation also passed its Qt widget fixtures, Rekordbox
  waveform/phrase regressions, phrase-layout/GL checks, and a **complete linked
  ARM64 build on the Pi**. See [integration notes](docs/PIONEERED-INTEGRATION.md).

Release qualification still requires physical FLX6 Browse/format-picker and inherited pad-mode
checks, multi-drive disconnect/eject testing, and a 30-minute two-deck run with
measured zero xruns under simultaneous display, analysis, and download load.
Local regression results do not establish live transfer speed or audio stability.

Validation procedures: [Rekordbox](docs/rekordbox-read-compatibility.md),
[storage and updates](docs/storage-reliability.md), and
[EDMC parsing and latency](docs/edmc-parser-and-validation.md).

## Repository layout

- `os/` is the PiFlex OS image definition: Debian package layer, Pi 5 display
  setup, kiosk, service priorities, CPU/IRQ tuning, recovery, USB mounting,
  updates, rollback, diagnostics, and optional RT-kernel configuration.
- BiteDJ source and the PiFlex modifications live at the repository root.
- `res/controllers/Pioneer-DDJ-FLX6*` contains the current FLX6 profile.
- `src/library/edmc/` contains BiteDJ's asynchronous EDMC client UI.
- `edmc-companion/` contains the Node.js/Playwright acquisition service. Browser,
  network, and download work stay outside the real-time audio process.
- `docs/BITEDJ-UPSTREAM.md` preserves BiteDJ's upstream project description.

## Build and install

The complete image workflow is documented in [`os/README.md`](os/README.md).
It uses Raspberry Pi `rpi-image-gen`, this repository's PiFlex OS layer, and an
ARM64 BiteDJ rootfs bundle. Create `os/config/piflex-os.yaml` from the public
example with your own username and SSH public key, prepare the application
assets, and build the flashable image from WSL/Linux.

Build BiteDJ using the upstream Linux instructions with this repository as the
source tree when producing a new application bundle. The application can be
built separately from the OS image, but Pi-specific system controls require
the runtime scripts and services. A standalone application installer is not
yet published. Source updates must be built and deployed to update a running Pi.

Image size varies with the application bundle, packages, and build configuration.

The EDMC companion requires **Node.js 20+**, system Chromium, and **ffmpeg**
(which supplies `ffprobe`). New image builds include ffmpeg; install it on older
images before deploying the latest companion:

```sh
cd edmc-companion
npm ci
npm test
```

## Legal and upstream attribution

PiFlex does not contain music, account credentials, cookies, or a preconfigured
EDMC session. Users are responsible for complying with service terms and only
downloading material they are authorized to access.

BiteDJ and Mixxx source remain licensed under GPL-2.0-or-later. Component and
skin licenses remain alongside their source. See [`LICENSE`](LICENSE),
[`COPYING`](COPYING), and [`NOTICE.md`](NOTICE.md).
