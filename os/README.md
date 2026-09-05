# PiFlex OS

This directory is the reproducible PiFlex OS image definition. It turns a
Debian 13 arm64 `minbase` filesystem into the complete Raspberry Pi 5 DJ
appliance: boot configuration, touch kiosk, audio/controller priorities,
networking, removable media, EDMC, recovery, updates, rollback, and BiteDJ.
It is built with Raspberry Pi `rpi-image-gen` v2.6.0.

Large prebuilt images and private per-device configuration are distributed
separately from the Git source. No password, private key, account session, or
music library belongs in a public image.

The current image profile includes:

- Pi 5 `linux-image-rpi-2712` packages with 16 KiB pages
- Official 10.1-inch Touch Display 2 in landscape orientation
- Sway kiosk startup with BiteDJ crash recovery
- Direct ALSA operation without a PulseAudio or PipeWire server
- CPU/IRQ tuning for BiteDJ audio and the FLX6 USB device
- Ethernet, Wi-Fi through iwd, SSH, mDNS, Chromium, and an on-screen keyboard
- Automatic removable-media mounts
- First-boot root partition expansion
- Hash-checked application updates and local rollback
- Optional PREEMPT_RT kernel build configuration

The development Pi already has PREEMPT_RT enabled (owner-confirmed September 4,
2026). The kernel configuration remains selectable in the image build; the
package list above is not a statement of that Pi's currently running kernel.
Its exact kernel version was not re-read during this update because the device
was unreachable. Sustained zero-xrun testing remains a separate acceptance gate.

Internal commands and service filenames currently retain the short `pflx-*`
prefix. The user-facing project and OS name is PiFlex.

## Configure

Copy the public template and replace the SSH-key placeholder with your own
public key:

```powershell
Copy-Item .\os\config\piflex-os.example.yaml .\os\config\piflex-os.yaml
```

The generated `piflex-os.yaml` is intentionally ignored by Git.

## Prepare application assets

Build an ARM64 BiteDJ rootfs bundle first, then run:

```powershell
& .\os\scripts\prepare-assets.ps1 -BiteDjRootfs C:\path\to\bitedj-rootfs.tar.gz
```

This copies the BiteDJ bundle, EDMC companion, and controller profile into the
ignored `os/assets/` staging directory and writes SHA-256 checksums.

## Build from WSL

The script accepts the WSL path to this `os` directory. Override its default
builder and output locations with `PFLX_IMAGE_GEN`, `PFLX_SOURCE_COPY`, and
`PFLX_BUILD_ROOT` if required.

```powershell
wsl.exe -d Ubuntu -u root -- bash -lc \
  "/mnt/c/path/to/PiFlex/os/scripts/build-wsl.sh /mnt/c/path/to/PiFlex/os"
```

The image is produced in the configured `rpi-image-gen` build root. Flash it
with Raspberry Pi Imager using **Use custom**.

## Updates without reflashing

```powershell
& .\os\scripts\package-update.ps1
```

This packages the existing ARM64 artifact; it does **not** rebuild BiteDJ.
Rebuild that artifact from the intended source first. The manifest records the
packaging checkout revision, dirty state, and binary hash separately; it does
not prove which source produced an older binary.

Copy the bundle, adjacent `.sha256`, and emitted `apply-update.sh` to the Pi.
Run over SSH, not a terminal inside the kiosk session that the update stops:

```sh
sudo bash /path/to/apply-update.sh /path/to/pflx-update.tar.gz
sudo pflx-rollback
```

The bootstrap runs the new updater even on images with the older updater.
The v2 allowlist includes BiteDJ, resources, EDMC, the restart supervisor,
companion launcher, USB mount helper, updater and rollback helper. The mount
helper's username template is resolved for the actual kiosk user.

The updater verifies the bundle hash and required payload, rejects unexpected
paths and links, serializes updates, and verifies a complete rollback copy
**before** stopping services or replacing installed files. Copy failures abort
the update. Installation failures attempt restoration; failed restoration
leaves services stopped. Complete v2 backups live under `/var/backups/pflx`.
Legacy unverified backups are not accepted by v2 rollback. Restoring an older
runtime also restores its older updater, so keep the bootstrap for subsequent
updates. Checksums detect corruption, not publisher authenticity.

See [storage reliability and validation](../docs/storage-reliability.md) for
tests and the remaining hardware acceptance gates.

## Hardware acceptance gates

Image validation cannot prove DSI behavior, USB IRQ timing, or live audio
stability. A release image must still pass:

1. Correct display and touch orientation at 1920x1200.
2. Ethernet, Wi-Fi, SSH, mDNS, and Chromium authentication.
3. FLX6 MIDI and four-channel ALSA reconnection.
4. Two decks for at least 30 minutes at the selected latency with zero xruns.
5. Jogging, faders, controller browsing, and loading without audible hitches.
6. Loading and analyzing another track without interrupting playing decks.
7. EDMC browsing and an authorized download while two decks continue playing.
8. Captured CPU affinity, FIFO priorities, temperature, throttling, and power
   state from `pflx-diagnostics`.

Generic QEMU does not faithfully emulate Pi 5 DSI, USB, or audio hardware. It
is only useful for ARM64 user-space, package, and service checks.
