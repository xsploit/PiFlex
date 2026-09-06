# Live workflow and metadata

The original workflow changes below are installed on the development Pi. The full ARM64 Release build
and focused native/controller tests pass. Physical-controller behavior and
third-party Unity/OBS clients still require end-to-end qualification.

## Analysis and touch-keyboard update

The following additions are installed on the development Pi:

- Stream settings: **Analysis: Rekordbox first** / **Analysis: BiteDJ only**.
  Rekordbox first protects imported grids/keys against generic reanalysis
  preferences and uses supported exported waveforms. Missing data follows the
  enabled native analyzers. Native-only removes imported grid/key/waveform
  artifacts while retaining cues and native caches. Locked grids are exceptions
  in both modes. Unload/reload to change policy; browsing a loaded track no
  longer reimports its analysis underneath playback.
- Phrases remain separate from cues. The CUE badge is at the top of the
  scrolling waveform, with no prefix block or horizontal spacing in the phrase
  lane. Displayed phrase boundaries map from the original export grid onto the
  edited grid, including variable tempo; undo uses the original data, not an
  accumulated offset. No audio or exported analysis files are rewritten by
  phrase projection. Native-only has no phrase labels because there is no
  native phrase detector.
- Stream settings: **Touch keyboard: auto/off**. Pi Wayland text-editor focus
  launches the installed native keyboard; read-only, disabled and hidden
  editors do not. Search/combo-box, multiline, password and numeric editors are
  covered. Focus handling is event driven rather than polled.

New regression checks: `test_phrase_alignment.py`, `test_cue_phrase_layout.py`,
`test_touch_keyboard.py`, and the native-only cue-pass cases in
`test_rekordbox_safety.py`. All passed, along with the existing waveform,
workflow, metadata and load-policy regressions. Live checks confirmed keyboard
opening, key entry filtering All Tracks, successful loading returning to Play,
keyboard hiding on leaving search, and the CUE badge above the waveform with
phrases below. Switching to BiteDJ only retained the already-loaded track's
phrases, as intended. The initial restoration check failed; the later toggle
correction below restored Rekordbox first and verified keyboard off/auto live.
Actual unload/reload comparisons between analysis policies, physical touch
input and controller-driven grid edits still need hands-on qualification.
Grid-edit/undo projection is covered by the production-code fixtures, not
claimed here as a completed live grid-edit test.

Current installation (2026-09-06): full ARM64 Release build passed. The installed
executable SHA-256 is
`7336f47c3e234c05c7c3eb8dc1971c5bb119ddc86215f4d2b993ff9dd2b6e1c6`.
Verified pre-update backup:
`/home/pompu_5/bitedj-before-rekordbox-20260906T083408Z`.
The supervised restart succeeded; the Pi was returned to Play with the test
track paused before the user resumed loading tracks. Touch keyboard auto was
enabled and metadata was off/local-only during the checks.
No media or library database was replaced.

## Loading and browsing

### Search Enter correction (installed, 2026-09-06)

The previous search widget could move focus into the track table when Enter was
pressed after the debounced search finishes. A subsequent/repeated Enter can
then activate the selected track. The corrected handler keeps Enter/Return in
search, including repeats; explicit result selection or Escape navigation is
separate. `test_search_submit.py` exercises the production handler with Qt key
delivery, fails against the previous handler and passes against the correction.
The ARM64 Release build and approved installation/restart passed. Live All
Tracks testing entered `fallout`, submitted Enter repeatedly, and then appended
`x`: the query became `falloutx`, focus stayed in search, and neither deck
loaded. Leaving search hid the keyboard. The two new analysis/keyboard settings
also now use two-state toggle controls rather than push controls, which could
set them to 1 without allowing a click back to 0.
Live checks of the final build confirmed Rekordbox first and keyboard off/auto
switching. Final settings are Rekordbox first, touch keyboard auto, metadata
off/local-only; returned to Play. The search regression was demonstrated on the
preceding build with the identical search handler, before the toggle-only fix.

Current executable SHA-256 (supersedes the earlier hashes in this document):
`59c105c0a9cb05b2b16c13b2e21c8972b737e58510f8d6cba22623fd476fb5eb`.
Verified pre-install backup:
`/home/pompu_5/bitedj-before-rekordbox-20260906T091750Z`.

General settings offers four Track Replace policies:

| Setting | Replacing a playing deck |
| --- | --- |
| Lock | Rejected |
| Fader | Allowed only with channel fader down or main-mix routing off; replacement stops |
| Stop | Allowed, replacement stops |
| Live | Allowed, replacement plays |

Fader is the default for fresh configurations. Existing saved choices are
preserved. The check uses routing controls, not momentary silence: a breakdown
does not make an open channel safe to replace. This does not measure external
hardware mixer routing or headphone audibility. Unknown controls fail closed.

Successful main-deck loads return to Play view by default. Stream settings has
an opt-out and the accelerated-browsing switch. All Tracks has a search field;
BPM/key are centered in compact, font-aware columns with adjustable width weights.

## Beatgrid controls

- Shift + jog: fine grid translation on that deck, replacing fast search.
- Shift + Browse: linked waveform zoom, unchanged.
- Beat FX arrows: existing effect behavior, unchanged.
- Grid Earlier/Later and BPM minus/plus buttons: larger targets, repeat after
  350 ms held, then every 80 ms. Set remains a single press.

## Independent streaming switches

Settings > Stream separates audio broadcasting from track metadata.
Neither switch requires the other to be enabled.

- Audio Start/Stop controls the existing Icecast/Shoutcast broadcaster.
  Connection settings opens its profiles, host, port, mount, credentials,
  codec, bitrate and reconnection controls. This is an audio **client**, not
  an Icecast server installer, VLC launcher or OBS configurator.
- Metadata Start/Stop controls a separate HTTP listener. It starts **off on
  every application launch**, even if it was enabled previously.
- Local only is the default. Share with LAN explicitly binds IPv4 interfaces;
  that choice is remembered, but does not start the listener by itself.
- Stop closes the listener and clients and cancels publishing/heartbeat timers.
  With no subscribers, control changes do not build or serialize snapshots.

## Metadata contract (version 1)

Port **8794**:

- `GET /v1/state`: one JSON snapshot.
- `GET /v1/events`: Server-Sent Events; named `state` events contain the same
  JSON structure, beginning with an immediate snapshot.

Top-level fields: `version`, `timestamp_ms`, `decks`, `on_air_candidates`,
`selection_rule`.

Each deck reports `group`, `loaded`, `playing`, `channel_fader`, `main_mix`,
`on_air_candidate`, `bpm`, and `rate_ratio`. Loaded decks also report `title`,
`artist`, `key`, `duration_seconds` and `position_seconds`.

Candidates are loaded, playing decks with their channel fader open and main-mix
routing enabled. Both decks are reported during a mix; the consumer decides how
to display them. This is not a guarantee of audible output: the crossfader,
master gain, external mixer and audio content are not evaluated.

Load/unload, playback, fader, routing, BPM and rate changes trigger coalesced
updates (at most 10 per second). Position is a snapshot, **not a continuous
beat/phase clock**. Consumers must not infer sample-accurate synchronization
from this stream. There is no library polling or new audio analysis.

The server is read-only, limits connections to eight, bounds request/output
buffers, times out incomplete requests, and sends 15-second SSE keepalives only
while subscribed. Clients should reconnect after restart or interface changes.

LAN sharing has no authentication: use it only on a trusted network, never
forward the port to the internet. No wildcard browser CORS access is granted.
Native Unity/OBS integrations or a same-origin bridge can consume the feed;
existing plugins are not automatically integrated by adding this API.

## Checks

- `node os/tests/test_flx6_workflow.cjs`
- `python3 os/tests/test_deck_load_policy.py`
- `python3 os/tests/test_live_metadata.py`
- `python3 os/tests/test_workflow_widgets.py`
- Existing `test_deck_presentation.py` and `test_waveform_time_scale.py`

Native fixtures require Qt 6 development libraries and a C++ compiler. TCP tests
exercise the actual metadata transport. Widget tests exercise production event
methods with Qt timers. These tests supplement, not replace, a full application
build and Pi hardware/UI checks.

### Earlier workflow installation, 2026-09-06 (superseded above)

- Installed executable SHA-256:
  `fd9be687281817756eab1d5c690ad82efa25f557035303cb008f3a7edf92f28c`.
- Runtime executable, changed resources and profile controller overrides were
  compared byte-for-byte to the staged build/source. Normalized pre-install
  resource audits found no Pi-only changes.
- Verified backup: `/home/pompu_5/bitedj-before-rekordbox-20260906T080246Z`.
  Includes previous executable/resources/source and the stopped app's profile
  config/controller files. No user media or library database was replaced.
- Existing supervisor restarted BiteDJ successfully. Metadata port 8794 was
  closed after launch, as intended. Larger grid buttons and the Stream tab
  rendered on the physical Pi display.
- Stream start returned real loaded-deck snapshots and SSE from the live Pi.
  Enabling LAN mode made `/v1/state` reachable from Windows. Stop closed the
  listener; the final setting was restored to off/local-only.
- General displayed Track Replace = Fader. Both workflow toggles were on.
  BPM/key width settings were changed from L to XS and the actual table showed
  compact, separated columns. The search field and enlarged grid buttons render.
- Returned the Pi to Play without unloading the user's newly loaded tracks.
  Physical jog behavior, hold-repeat grid mutations, routing transitions and
  successful-load navigation still need hands-on validation. The API alone
  does not establish integration with Unity or an OBS plugin.
- Audio broadcaster displayed Disconnected; no successful audio stream is
  claimed. Startup also reported an empty existing `Connection 1.bcp.xml`
  profile. No broadcast credentials/profiles were changed during these checks.
