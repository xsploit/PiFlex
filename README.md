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
- Official Raspberry Pi Touch Display 2 (10.1-inch, 1920x1200)
- Pioneer DDJ-FLX6
- USB media exported by Rekordbox

## Why a custom OS?

PiFlex OS exists to give live audio predictable access to the Pi instead of
running BiteDJ on top of a normal desktop installation. The current image:

- starts from Debian 13 arm64 `minbase`, not Raspberry Pi OS Desktop
- boots straight into a minimal Sway/Wayland kiosk with Xwayland disabled
- uses direct ALSA with no PulseAudio or PipeWire server
- runs the CPU governor in performance mode and disables swap during a set
- reserves CPU 3 for BiteDJ's audio callback and CPU 2 for controller/USB work
- moves USB-host interrupts to CPU 2 and applies real-time priority when the
  running kernel exposes threaded IRQs
- gives the BiteDJ session real-time and locked-memory limits
- confines EDMC/Chromium work to CPUs 0-1 at low CPU and idle I/O priority
- disables unattended package timers and unnecessary background maintenance
- bounds persistent logs so they cannot gradually fill the card
- automounts DJ USB media and expands the root filesystem on first boot
- provides SSH, mDNS, recovery shortcuts, application updates, and rollback

The development image compresses to about 653 MB and expands to a roughly
5.7 GB flashable image. Chromium and networking remain available because EDMC
authentication and field recovery are explicit PiFlex requirements; they are
kept outside the real-time audio process.

## Current status

PiFlex OS is a working developer image for the target hardware below. It is not
yet a broadly supported appliance release.

Verified on the target system:

- Pi 5 boot, display, touch, Ethernet, Wi-Fi, SSH, and automatic BiteDJ launch
- DDJ-FLX6 MIDI control and its native audio interface
- Two-deck mixing and headphone output
- Rekordbox USB library browsing and track loading
- FLX6-focused controller mapping and touch layout changes
- Authenticated EDMC browsing through an out-of-process companion
- Streaming MP3, FLAC, and WAV downloads directly to removable USB storage
- Loading downloaded files through BiteDJ's normal local-track machinery

Implemented but awaiting another physical-controller verification pass:

- Focus-independent Browse encoder navigation across the source sidebar,
  native library views, and EDMC screens
- Encoder-driven EDMC file-format selection

Not yet proven:

- A 30-minute two-deck run with measured zero xruns
- Safe analysis and EDMC downloading under worst-case live load
- The staged PREEMPT_RT kernel on the complete display, USB, and audio stack.
  The current image boots the packaged Pi 5 kernel first so recovery remains
  available; the RT kernel is a measured follow-up test, not a performance
  claim.
- Controllers, displays, or Raspberry Pi boards other than the target above
- A stable, supported end-user image/update channel

## Repository layout

### EDMC reliability update (September 2026)

The companion now reads the current genre catalog, handles MP3/WAV/FLAC labels
more reliably, and avoids visiting every preview page just to list file types.
Clearly labelled options resolve from one release page; recent resolve results
are cached. Downloaded audio is checked with `ffprobe` before being marked ready,
with connection/idle timeouts and partial-file cleanup.

The storage layer supports distinct USB identities and an explicit SD fallback
for new work when the selected USB is unavailable. Updates require verified
backups and include their runtime scripts. Existing Pi images need the
`ffmpeg` package (which supplies `ffprobe`) before installing this update; new
image builds include it.

Local verification: 51 Node checks pass on Linux/WSL; Windows passes 49 with
two Linux-only skips. Six updater fixture tests pass. These changes have **not
yet been deployed or performance-tested on the Pi**; they are not a claim of
faster Internet transfers or interruption-free live playback.

See the [companion README](edmc-companion/README.md) and
[parsing, validation and latency notes](docs/edmc-parser-and-validation.md).

### Source directories

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
