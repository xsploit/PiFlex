# BiteDJ EDMC companion

This is the standalone acquisition side of BiteDJ's EDMC workflow. It is a
Node.js service that controls the Raspberry Pi OS system Chromium through
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

The proof UI and the eventual BiteDJ sidebar use the same versioned API. The
proof UI is disposable; the companion, USB layout, job states, and API are the
building blocks that stay.

## Raspberry Pi behavior

- The first sign-in opens visible system Chromium with a dedicated profile.
- Refresh and download work reuse that profile. They run headless when no
  visible companion window already exists.
- Only one browser job runs at a time.
- The browser is not kept alive by the service when it has no work.
- The final media transfer is streamed directly to the selected USB. The
  default destination is `Music/EDMC/<subsection>`, but the folder and whether
  subsection folders are used are persisted settings. A track
  is first written under `.bitedj/edmc/incoming`, synchronized, identified by
  its MP3, FLAC, or WAV magic bytes, and renamed onto `Music/EDMC` with the
  verified extension on the same filesystem.
- `library.json` is also replaced atomically. It is the future source for the
  BiteDJ `EDMC Downloads` library feature.
- The service is intended to run with low CPU and I/O weight. BiteDJ remains
  the real-time priority.

## Development run

```bash
npm install
npm test
npm start -- --ui --usb-root /media/$USER/MUSIC_USB
```

By default the service expects Chromium at `/usr/bin/chromium`. Override it
with `BITEDJ_EDMC_CHROMIUM=/path/to/chromium`.

Local state and the Chromium profile live below
`$XDG_DATA_HOME/bitedj-edmc`, or `~/.local/share/bitedj-edmc` when
`XDG_DATA_HOME` is unset.

## API v1

- `GET /v1/status`
- `GET /v1/subscriptions`
- `PUT /v1/subscriptions`
- `POST /v1/storage` with `{ "path": "/media/..." }`
- `GET /v1/settings`
- `PUT /v1/settings` with `{ "downloadFolder": "Music/EDMC", "organizeByGenre": true }`
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
poll `/v1/jobs`; BiteDJ can initially use the same mechanism from
`QNetworkAccessManager` without adding WebSockets or a web engine.

## Hardware proof gates

Local tests do not claim the Pi workflow is proven. The live gates are:

1. Visible EDMC sign-in on the Pi.
2. Close Chromium, reboot, and pass `auth/check` without signing in again.
3. Refresh one selected subsection.
4. Download one account-authorized track to a selected USB with no `.part`
   file left behind.
5. Load that exact file through BiteDJ's existing
   `Computer -> Removable Devices` browser.
6. While a deck is playing, repeat refresh/download and check xruns, CPU,
   memory, and UI responsiveness before enabling automatic analysis.

No BiteDJ compile is required until those gates pass.
