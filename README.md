# PiFlex OS

PiFlex OS is a custom, performance-focused Raspberry Pi operating-system image
for standalone DJ hardware. It boots directly into a touch-first DJ interface
and replaces a general-purpose desktop with a deliberately small kiosk,
audio, controller, removable-media, networking, recovery, and update stack.

[BiteDJ](https://github.com/TeamDeckshark/bitedj), itself based on
[Mixxx](https://mixxx.org/), is the DJ engine inside the image. PiFlex is not
just a BiteDJ skin or controller mapping. This repository contains the complete
PiFlex OS image recipe and runtime layer as well as the modified BiteDJ source
and EDMC companion used by that image.

The name refers to a flexible Pi DJ system, not a claim that every controller
or Raspberry Pi model is already supported.

The current development target is:

- Raspberry Pi 5 (4 GB)
- Official [Raspberry Pi Touch Display 2](https://www.raspberrypi.com/products/touch-display-2/)
  (10-inch model, configured as 1920x1200 landscape)
- Pioneer DDJ-FLX6
- USB media exported by Rekordbox

## BiteDJ customizations

The application is more than the stock BiteDJ interface bundled into an image.
PiFlex adds display choices, controller-first library workflows, EDMC integration,
and appliance controls. The underlying playback engine, effects, cue machinery,
and much of the USB/library support come from BiteDJ and Mixxx; they are not
presented here as newly invented PiFlex features.

### Published application changes

The following are in this branch's committed source. Source availability does
not mean every change is installed in an older Pi image or hardware-validated;
see [Current status](#current-status) for that distinction.

- **Independent layouts and themes:** choose PiFlex, XDJ, or Pioneer for the
  main deck layout and independently for the visual theme. Day/Night lighting,
  display defaults reset, and persisted library text sizing are exposed in
  Settings. These are presentation choices, not emulations of Pioneer firmware.
- **Waveform controls:** RGB, filtered, and stacked styles; fixed or EQ-responsive
  rendering; Slim/PiFlex/Bold visual height and Wide/PiFlex/Near zoom presets.
  The full-deck-width layout fix is included. Imported analysis uses BiteDJ's
  renderers; scrolling zoom is not a zoom control for the whole-track overview.
- **Library and preparation:** All Tracks combines local and Rekordbox tracks,
  a controller-first Prepare list supports set preparation, and library column
  visibility and relative widths are configurable. Library text size persists
  across restarts.
- **Controller navigation and load safety:** the FLX6 profile supports the
  touch-first workflow; Browse navigation covers the source list, track views,
  and EDMC, including format selection. Deck Lock exposes Lock/Stop/Live load
  policies. The latest Browse/format changes still need the physical-controller
  verification pass listed below.
- **EDMC inside BiteDJ:** search and browse releases, choose download formats,
  and load/preview downloaded tracks through the normal local-track path.
  Settings expose Music/EDMC, Downloads, USB/EDMC, or a custom destination;
  flat or genre folders; and manual or automatic addition to All Tracks.
  Authentication, browser automation, and transfers run in the separate
  companion, not the audio callback.
- **Appliance controls:** USB drive management, an explicit Restart BiteDJ
  action, and supervisor handling that distinguishes requested restarts from
  failures. Download-aware eject coordinates with EDMC before unloading and
  unmounting the selected drive, as described below.

Source entry points: [settings and display controls](res/skins/BiteDJ/settings.xml),
[BiteDJ skin](res/skins/BiteDJ/), [FLX6 mapping](res/controllers/Pioneer-DDJ-FLX6.midi.xml),
[library integration](src/library/), [native EDMC client](src/library/edmc/),
and [EDMC companion](edmc-companion/README.md).

### Detailed feature inventory

This inventory includes the smaller workflow and reliability changes, not just
the headline features. Entries describe committed implementations; hardware
acceptance status is listed separately below.

Jump to: [Display](#display-skins-and-waveform-layout) ·
[FX/key/grid](#fx-key-and-beatgrid-controls) ·
[FLX6](#flx6-mapping-and-jog-response) ·
[Library](#library-prepare-and-browsing-responsiveness) ·
[EDMC](#edmc-browsing-search-downloads-and-file-validation) ·
[USB/SD](#multiple-usbs-sd-fallback-and-safe-eject) ·
[Rekordbox](#rekordbox-prepared-analysis-details) ·
[OS/recovery](#os-integration-deployment-and-recovery-additions) ·
[Inherited features](#retained-upstream-features-available-in-this-build).

#### Display, skins, and waveform layout

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
- **Linked zoom** for both decks, including FLX6 Shift + Browse and the Wave panel.
- Stable scrolling-waveform height when changing **channel trim**; audio trim
  still changes the sound, while the visualization retains its comparison scale.
- Migration of stale user skin overrides during updates, so an old local skin
  does not hide the newly installed interface.

#### FX, key, and beatgrid controls

- An overview side panel with separate **FX, Key, Wave, and Grid** pages.
- Touch-sized effect selection: widened popup, full effect names, larger rows,
  and scrolling without the gesture handler swallowing effect-selection taps.
- FX deck assignment, wet/dry mix, enable/disable, and exposed parameter controls.
- **Beat FX period selection** linked to the controller's Beat left/right buttons:
  1/8, 1/4, 1/2, 1, 2, and 4 beats where the selected parameter supports them.
- **Key page:** per-deck key readout, two-semitone up/down controls, harmonic
  Match using the existing engine control, and reset to the file key. These
  retain and adapt BiteDJ/Mixxx's key controls, not a new key-analysis algorithm.
- **Wave page:** linked zoom Out, Reset, and In controls.
- **Grid page:** per-deck shift-earlier, set-grid-at-current-position,
  shift-later, BPM slower, and BPM faster controls.

Sources: [overview panels](res/skins/BiteDJ/effects.xml),
[beatgrid controls](res/skins/BiteDJ/templates/grid_deck_row.xml),
[key controls](res/skins/BiteDJ/templates/keyfx_deck_row.xml), and
[touch effect selector](src/widget/weffectselector.cpp).

#### FLX6 mapping and jog response

- Added the DDJ-FLX6 MIDI XML and script, adapted from the credited community
  mappings. Mixer, faders, EQ, filter, gain, headphone cue, transport, jog,
  looping, tempo range, sync, and pad-mode bindings are present; this does not
  certify every inherited pad mode on the physical controller.
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

#### Library, Prepare, and browsing responsiveness

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

#### EDMC browsing, search, downloads, and file validation

- Native BiteDJ EDMC screens backed by a separate **Node.js/Playwright companion**.
- Sign-in through system Chromium with a dedicated persisted browser profile;
  later jobs reuse the profile and serialize browser work.
- Grouped genre/category navigation, release browsing, and **EDMC Music search**
  from BiteDJ (minimum two characters), rather than only browsing a saved list.
- Release format selection, queued jobs, progress/status, and cancellation.
- **Load and Preview** completed downloads through BiteDJ's local-track path.
- Download destinations: **Music/EDMC, Downloads, USB/EDMC, or Custom**.
- **Flat or By Genre** folders; **Manual or Auto Add** to All Tracks.
- Setup UI for selecting the destination and managed SD fallback policy.
- Updated genre parser deduplicates numeric genre IDs and handles the sampled
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

#### Multiple USBs, SD fallback, and safe eject

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

#### Rekordbox prepared-analysis details

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

Exact compatibility limits and test commands are in
[Rekordbox read compatibility](docs/rekordbox-read-compatibility.md).

#### OS integration, deployment, and recovery additions

- Debian minimal-image recipe, direct-ALSA kiosk, display/touch configuration,
  networking, removable-media automount, and first-boot filesystem expansion.
- Pi GPU/DSI renderer selection in the Wayland launcher to avoid advertising a
  software-only rendering path to the application.
- Audio/controller CPU policy and USB IRQ tuning; background caching work on
  CPUs 0-1. The GUI stays on normal scheduling instead of passing FIFO policy
  to Qt rendering workers. PREEMPT_RT status and tuning are described below.
- EDMC service CPU affinity, low CPU/I/O priority, and memory-pressure settings.
- Journal limits, disabled maintenance timers, and swap/performance-governor setup.
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

#### Retained upstream features available in this build

These are included product capabilities, **not all newly authored by PiFlex**.
The retained BiteDJ/Mixxx base also supplies:

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

### Rekordbox analysis and storage integration

The following implementations and regression tests are included in this branch.
Build a new application bundle to install native changes on an older image;
pushing source does not update a running Pi automatically.

| Area | Included implementation and compatibility boundary |
| --- | --- |
| Rekordbox analysis loading | Bounds/cycle checks for database page chains, DAT-only beat/cue handling, and application of user overrides after import. Analysis parse failures produce warnings without intentionally blocking audio loading; this is not a guarantee against every malformed export. |
| Exported waveforms | Import of `.2EX` three-band overview/detail data, with amplitude normalization adapted to BiteDJ's renderer. Native style, gain, and zoom remain separate controls; this is not pixel-identical Pioneer rendering. |
| Phrase display | Imported `PSSI` phrases appear below the whole-track overview and along the lower part of the scrolling waveform. Phrase/fill timing follows the exported beat grid. Tracks without exported phrase data have no imported phrase strip; this does not generate missing analysis. |
| Native storage integration | Keep downloaded-track Load/Preview state tied to its actual storage identity, and coordinate the Settings eject action with the companion. Both the companion APIs and native-client integration are included. Multiple USB destinations stay distinct; explicit SD fallback applies to new jobs, not migration of interrupted downloads. |

See [Rekordbox compatibility and tests](docs/rekordbox-read-compatibility.md) and
[storage, eject, and update validation](docs/storage-reliability.md) for the
test commands and remaining hardware acceptance checks.

The Rekordbox scope is **reading existing exported USB libraries and their
available analysis**. Full OneLibrary/Device Library Plus-only support, desktop
`master.db` support, guest player-settings mapping, and writing playlists/cues
back for Rekordbox or Pioneer players are not promised. This is not full CDJ or
XDJ-RX feature parity.

### Application versus OS

The modified BiteDJ application source is available here independently of the
image recipe in `os/`. Building that source is distinct from flashing PiFlex OS;
Pi-specific system controls also depend on the runtime scripts/services. There
is not yet a separately published PiFlex BiteDJ-only distribution or supported
standalone installer. A separate application fork/package remains a packaging
decision, not something already delivered by this README.

## Why a custom OS?

PiFlex OS aims to give live audio predictable access to the Pi instead of
running BiteDJ on top of a normal desktop installation. The committed image
recipe configures the following; effective settings on a particular Pi still
need runtime verification:

- starts from Debian 13 arm64 `minbase`, not Raspberry Pi OS Desktop
- boots straight into a minimal Sway/Wayland kiosk with Xwayland disabled
- uses direct ALSA with no PulseAudio or PipeWire server
- requests the performance CPU governor and disables swap during startup
- configures CPU isolation and requests CPU 3 for BiteDJ's audio callback and
  CPU 2 for controller work
- attempts to move USB-host interrupts to CPU 2 and apply real-time priority
  when the running kernel exposes threaded IRQs
- gives the BiteDJ session real-time and locked-memory limits
- confines EDMC/Chromium work to CPUs 0-1 at low CPU and idle I/O priority
- disables unattended package timers and unnecessary background maintenance
- bounds the persistent system journal (64 MiB cap and seven-day retention);
  this is not a quota on every application log or file
- automounts DJ USB media and expands the root filesystem on first boot
- provides SSH, mDNS, recovery shortcuts, application updates, and rollback

Image size depends on the application bundle, packages, and build configuration;
no fixed download size is promised for the current source. Chromium and
networking remain available because EDMC
authentication and field recovery are explicit PiFlex requirements; they are
kept outside the real-time audio process.

Configuration evidence: [image customization](os/scripts/customize-rootfs.sh),
[session service](os/layer/rootfs-overlay/etc/systemd/system/pflx-session.service),
[runtime tuning](os/layer/rootfs-overlay/usr/local/sbin/pflx-tune), and
[companion service](os/layer/rootfs-overlay/etc/systemd/system/pflx-edmc.service).

## Current status

Status reviewed September 4, 2026 against source through `e28a950e84` and the
development test record. The application changes above are committed, not a
list of unpublished plans. PiFlex OS remains a development image, not yet a
broadly supported appliance release.

Previously reported working on the development Pi (not re-tested in this
documentation audit, and not proof that every latest commit is installed):

- Pi 5 boot, display, touch, Ethernet, Wi-Fi, SSH, and automatic BiteDJ launch
- DDJ-FLX6 MIDI control and its native audio interface
- Two-deck mixing and headphone output
- Rekordbox USB library browsing and track loading
- FLX6-focused controller mapping and touch layout changes
- Authenticated EDMC browsing through an out-of-process companion
- EDMC downloading to removable USB storage
- Loading downloaded files through BiteDJ's normal local-track machinery

Implemented but awaiting another physical-controller verification pass:

- Focus-independent Browse encoder navigation across the source sidebar,
  native library views, and EDMC screens
- Encoder-driven EDMC file-format selection

PREEMPT_RT is enabled on the development Pi, as confirmed by its owner on
September 4, 2026. The earlier description of it as merely staged was stale.
The Pi was unreachable during this documentation refresh, so the exact running
kernel version was not re-read. This does not establish a measured zero-xrun
result or change the default kernel selected by every image build.

Not yet proven:

- A 30-minute two-deck run with measured zero xruns
- Safe analysis and EDMC downloading under worst-case live load
- Sustained, measured PREEMPT_RT behavior under simultaneous display, USB,
  analysis, download, and two-deck audio load
- Controllers, displays, or Raspberry Pi boards other than the target above
- A stable, supported end-user image/update channel

## EDMC reliability update (September 2026)

The companion parses the genre navigation sampled during the September 2026
audit, handles MP3/WAV/FLAC labels
more reliably, and avoids visiting every preview page just to list file types.
Clearly labelled options resolve from one release page; recent resolve results
are cached. New downloads receive signature and bounded `ffprobe` stream/packet
checks before being marked ready, with connection/idle timeouts and partial-file
cleanup. This is not a full audio decode or audible-quality guarantee; existing
library inventory uses cheaper size/signature checks.

The storage layer supports distinct USB identities and an explicit SD fallback
for new work when the selected USB is unavailable. Updates require verified
backups and include their runtime scripts. Existing Pi images need the
`ffmpeg` package (which supplies `ffprobe`) before installing this update; new
image builds include it.

Verification recorded September 4, 2026: 51 Node checks passed on Linux/WSL
(including a discovered fixture helper); the preceding Windows run passed 49
with two Linux-only skips. Six updater tests and native storage, Rekordbox,
phrase-layout, and drawing fixtures passed. Eight C++ translation units passed
syntax checks; this was not a complete linked ARM64 build. The latest EDMC
reliability update has no confirmed Pi deployment/performance result in this
audit. None of these results establishes Internet transfer speed or
interruption-free live playback.

See the [companion README](edmc-companion/README.md) and
[parsing, validation and latency notes](docs/edmc-parser-and-validation.md).

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

## Controller scope

PiFlex is designed around controller profiles. The FLX6 is the first and only
fully targeted profile today. Additional mappings are welcome, but their
presence in upstream Mixxx or BiteDJ does not mean they have been tested on
PiFlex hardware.

## Building the image

The complete image workflow is documented in [`os/README.md`](os/README.md).
It uses Raspberry Pi `rpi-image-gen`, this repository's PiFlex OS layer, and an
ARM64 BiteDJ rootfs bundle. Create `os/config/piflex-os.yaml` from the public
example with your own username and SSH public key, prepare the application
assets, and build the flashable image from WSL/Linux.

Build BiteDJ using the upstream Linux instructions with this repository as the
source tree when producing a new application bundle.

The EDMC companion requires Node.js 20 or newer:

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
