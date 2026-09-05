# BiteDJ EDMC companion

This is the standalone acquisition side of BiteDJ's EDMC workflow. It is a
Node.js service that controls system Chromium on the Pi through
Playwright. It does not run inside BiteDJ and it never runs work on Mixxx's
audio thread.

## Product boundary

```text
BiteDJ or proof UI
        |
        | HTTP JSON on 127.0.0.1:17642
        v
bitedj-edmc companion
        |
        | one serialized Playwright worker
        v
system Chromium + dedicated persistent profile
        |
        | streaming download; Chromium can close after URL resolution
        v
selected USB/<configured folder>/<optional subsection>/<track>.(mp3|flac|wav)
selected USB/.bitedj/edmc/library.json
```

The setup/proof UI and the implemented BiteDJ client use the same versioned API. The
proof UI is disposable; the companion, USB layout, job states, and API are the
building blocks that stay.

## Raspberry Pi behavior

- The first sign-in opens visible system Chromium with a dedicated profile.
- Refresh and download work reuse that profile. They run headless when no
  visible companion window already exists.
- Only one browser job runs at a time.
- The browser is not kept alive by the service when it has no work.
- The final media transfer is streamed directly to the selected USB or managed
  SD fallback. For USB storage, the
  default destination is `Music/EDMC/<subsection>`, but the folder and whether
  subsection folders are used are persisted settings. A track
  is first written under `.bitedj/edmc/incoming`, synchronized, checked by its
  signature and a bounded `ffprobe` audio-stream/packet inspection, and renamed
  into the configured folder with the detected extension on the same filesystem.
- A missing selected USB can fall back to explicitly managed SD storage for
  new work. A running download is pinned to its original destination; removal
  does not redirect it into an empty system-disk mountpoint. Two USB devices
  retain separate identities. Drive changes are rejected while downloads run.
- `library.json` is also replaced atomically. The companion reconciles it with
  release/download state served to BiteDJ for Load/Preview and library import.
- The service is intended to run with low CPU and I/O weight. BiteDJ remains
  the real-time priority.

## Development run

Requires Node.js 20+, system Chromium, and `ffprobe` from the `ffmpeg` package.
The tests also use `ffmpeg` to generate real audio fixtures. On Debian/Pi images,
install `ffmpeg` before updating an existing installation. New PiFlex images
include it, and the updated installer refuses this payload if it is missing.

```bash
npm ci
npm test
npm start -- --ui --usb-root /media/$USER/MUSIC_USB
```

By default the service expects Chromium at `/usr/bin/chromium`. Override it
with `BITEDJ_EDMC_CHROMIUM=/path/to/chromium`.
An explicit probe executable can be selected with
`BITEDJ_EDMC_FFPROBE=/path/to/ffprobe`. Missing validation tooling produces a
clear download error; there is no silent signature-only fallback.

## Format lookup and speed

- Current grouped site navigation supplies the genre catalog, deduplicated by
  numeric genre ID rather than URL spelling.
- MP3/WAV/FLAC labels beside the uploaded file are parsed separately from post
  commentary. Only unknown types need a BeatEXS metadata visit (12-second limit).
  An MP3 preview does not imply the uploaded source is MP3.
- Two clearly labelled options need one release-page navigation instead of
  three. Repeated resolve requests use a 15-minute cache. Old parser labels are
  invalidated once without deleting downloaded files.
- Connection/header and body-idle timeouts default to 30 seconds; stalled or
  invalid downloads do not remain as completed tracks. Progress updates are
  throttled rather than emitted for every network chunk.
- Audio checks record codec, duration, sample rate, channels and bitrate.
  They reject signature-only files and AAC disguised as MP3, but are not a full
  decode or an audible-quality guarantee. Existing library inventory stays a
  cheap size/signature check rather than rescanning every file.

Checks recorded September 4, 2026: **51 pass on Linux/WSL; 49 pass and two Linux-only skips on Windows**
(Node's count includes its discovered fixture helper). Live browser samples
confirmed the repaired catalog and dual-format labels. Deployment of the latest
reliability update, live-host throughput and simultaneous playback/load testing
have not been confirmed by this audit.

See [implementation and test details](../docs/edmc-parser-and-validation.md).

Local state and the Chromium profile live below
`$XDG_DATA_HOME/bitedj-edmc`, or `~/.local/share/bitedj-edmc` when
`XDG_DATA_HOME` is unset.

## API v1

- `GET /v1/status`
- `GET /v1/subscriptions`
- `PUT /v1/subscriptions`
- `POST /v1/storage` with `{ "path": "/media/..." }`
- `POST /v1/storage/prepare-eject` with `{ "path": "/media/..." }`
- `POST /v1/storage/cancel-eject` with `{ "path": "/media/..." }`
- `GET /v1/settings`
- `PUT /v1/settings` with `{ "downloadFolder": "Music/EDMC", "organizeByGenre": true, "fallbackToSd": true }`
- `POST /v1/ui/open`
- `POST /v1/auth/open`
- `POST /v1/auth/check`
- `POST /v1/browser/close`
- `GET /v1/releases`
- `POST /v1/refresh` with `{ "subscriptionId": "jump-up" }`
- `POST /v1/resolve` with `{ "topicId": 708681 }`
- `POST /v1/download` with `{ "topicId": 708681, "providerId": "..." }`
- `GET /v1/jobs`
- `POST /v1/jobs/<id>/cancel`

Refresh, resolve, and download calls enqueue work and return a job ID. Clients
poll `/v1/jobs`; BiteDJ uses `QNetworkAccessManager` without embedding WebSockets
or a web engine for this integration.

## Hardware proof gates

Earlier Pi use was reported working, but local regression tests do not certify
the newest source on the hardware. Repeat these gates for a release candidate:

1. Visible EDMC sign-in on the Pi.
2. Close Chromium, reboot, and pass `auth/check` without signing in again.
3. Refresh one selected subsection.
4. Download one account-authorized track to a selected USB with no `.part`
   file left behind.
5. Load that exact file through BiteDJ's existing
   `Computer -> Removable Devices` browser.
6. While a deck is playing, repeat refresh/download and check xruns, CPU,
   memory, and UI responsiveness before enabling automatic analysis.

Companion-only changes can be tested without rebuilding BiteDJ. Changes to its
native client require rebuilding and deploying the application as well.
