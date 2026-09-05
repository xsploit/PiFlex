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
- bounds persistent logs so they cannot gradually fill the card
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
