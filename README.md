# PiFlex

PiFlex is an experimental, Raspberry Pi-based standalone DJ platform built on
[BiteDJ](https://github.com/TeamDeckshark/bitedj), which is itself based on
[Mixxx](https://mixxx.org/). The name refers to a flexible Pi DJ system, not a
claim that every controller or Raspberry Pi model is already supported.

The current development target is:

- Raspberry Pi 5 (4 GB)
- Official Raspberry Pi Touch Display 2 (10.1-inch, 1920x1200)
- Pioneer DDJ-FLX6
- USB media exported by Rekordbox

## Current status

PiFlex is a developer preview, not a finished appliance image.

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
- The optional PREEMPT_RT kernel on the complete hardware stack
- Controllers, displays, or Raspberry Pi boards other than the target above
- A supported end-user image/update channel

## Repository layout

- BiteDJ source and the PiFlex modifications live at the repository root.
- `res/controllers/Pioneer-DDJ-FLX6*` contains the current FLX6 profile.
- `src/library/edmc/` contains BiteDJ's asynchronous EDMC client UI.
- `edmc-companion/` contains the Node.js/Playwright acquisition service. Browser,
  network, and download work stay outside the real-time audio process.
- `os/` contains the Pi 5 image layer, kiosk services, performance tuning,
  diagnostics, update tooling, and an optional RT-kernel configuration.
- `docs/BITEDJ-UPSTREAM.md` preserves BiteDJ's upstream project description.

## Controller scope

PiFlex is designed around controller profiles. The FLX6 is the first and only
fully targeted profile today. Additional mappings are welcome, but their
presence in upstream Mixxx or BiteDJ does not mean they have been tested on
PiFlex hardware.

## Building

Build BiteDJ using the upstream Linux instructions, with this repository as the
source tree. The PiFlex image tooling is documented in [`os/README.md`](os/README.md).
The image build expects an ARM64 BiteDJ rootfs bundle and requires you to create
`os/config/piflex-os.yaml` from the provided example with your own SSH public
key.

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
