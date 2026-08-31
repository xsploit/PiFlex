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

On the Pi:

```sh
sudo pflx-update /path/to/piflex-update.tar.gz
sudo pflx-rollback
```

The updater only accepts BiteDJ, Mixxx resources, and the EDMC companion. It
verifies the bundle hash, rejects unexpected paths and symbolic links, and
retains the previous application under `/var/backups/pflx`.

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
