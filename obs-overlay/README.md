# BiteDJ SVG now-playing overlay

Transparent vector lower-thirds driven by BiteDJ's read-only metadata events.
The graphic is [an editable SVG](public/now-playing.svg); a small Browser Source
wrapper updates its text. The setup page is **not** the on-stream graphic.
No backgrounds, cover-art lookups, remote fonts, CDN dependencies, or playback
commands. Node.js 22+ is the only runtime dependency.

## Run on the OBS computer

From this directory in PowerShell:

```powershell
./Start-Overlay.ps1 -Source http://192.168.1.80:8794
```

Replace the address with your Pi's address. For Linux or other Node setups:

```sh
BITEDJ_SOURCE=http://192.168.1.80:8794 node server.mjs
```

Open `http://127.0.0.1:8795/` to choose the accent, transparent or subtle-backed
style, optional BPM/key, and track-selection mode. Copy the generated **live**
URL into an OBS Browser Source, width **900**, height **320** for two decks.
For one track, use roughly **900 × 166**. Resize within OBS as needed. More
than two visible decks need a taller source. Enable **Shutdown source when
not visible** to release the connection. Stop the bridge with Ctrl+C.

On the Pi, enable **Settings > Stream > Metadata** and **Share with LAN**.
The metadata listener starts off each time BiteDJ launches. Audio broadcasting
is separate. No Pi update is needed if its existing v1 metadata server is installed.

The optional `node install-obs.mjs` helper adds a Browser Source to the current
OBS scene using the local OBS WebSocket configuration. It refuses installation
while streaming or recording, does not start outputs or switch scenes, and leaves
an existing same-named source untouched. `--inspect` is read-only. This helper
has not yet been verified against a running OBS instance.

## Selection and failure behavior

- **Mix** (default): display all playing decks with an open channel fader and
  main-mix routing enabled, in stable deck order.
- **Dominant**: display the candidate with the highest channel fader; ties go
  to the lower deck number. This is not loudness detection or automatic DJing.
- **Loaded / fixed deck**: intentionally include loaded tracks even when paused.
- No candidates means an empty transparent overlay. A broken connection clears
  stale text, then retries with capped exponential backoff.
- Metadata strings are text-only, length-bounded, and fitted to the SVG. BPM is
  displayed as reported, not used to invent an audio clock.
- One upstream SSE connection is shared among local overlays. With no viewers,
  it disconnects; no repeated library requests or audio analysis are performed.
- The bridge listens on loopback only, validates Host/Origin, and is read-only.

The downloaded SVG template contains example text and is static in an OBS Image
Source. Use the `/overlay` URL for live updates. `?demo=1` is an explicitly labeled
example preview and never goes into the URL copied by the setup page.

## Verification

`npm test` runs selection, validation, SSE framing, Unicode, shared-connection,
reconnection, stale-state, and HTTP boundary tests. `node test/browser-fixture.mjs`
provides a separately labeled manual test source on port 8797. These checks
do not claim a live Pi-to-OBS stream; both were unavailable during initial work.

## What's Now Playing integration research

[What's Now Playing](https://github.com/whatsnowplaying/whats-now-playing) is a
separate open-source application from [Now Playing](https://www.nowplayingapp.com/).
Its existing OBS template system is a candidate for a fuller integration instead
of expanding this small SVG widget into another streaming application.

Source inspected at `a462f9c94df9557a4d6c1a00150c2b32f472aae1`:

- `docs/input/remote.md` and `docs/reference/api.md`: Remote Input accepts JSON
  artist/title and additional metadata at `POST /v1/remoteinput`. Optional shared
  authentication uses the `X-WNP-Client-Auth` header.
- `nowplaying/inputs/remote.py`: receives track metadata through its remote DB.
- `docs/gallery/webserver.md`: existing template gallery and persistent/fading
  track overlays. These are rendered as browser overlays, not native OBS plugins.
- `nowplaying/inputs/jsonreader.py` is a disabled testing plugin, not the intended
  production integration entry point.

No WNP code or templates have been copied, no WNP service is installed/configured,
and no metadata is being forwarded to it. A future adapter should send deduplicated
track changes, not every fader event. It must also define one-track selection during
mixes, clearing/staleness behavior, and optional metadata-enrichment lookups before
claiming parity with the direct two-deck overlay. Remote Input can trigger enrichment;
this is not necessary to display the metadata already available from BiteDJ.
