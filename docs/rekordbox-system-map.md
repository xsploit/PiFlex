# Rekordbox 6.7 → BiteDJ: system map and implementation decisions

2026-09-06. This is an integration map, **not recovered Rekordbox source code**.
Evidence is separated into official behavior, version-pinned static observations,
and code we can inspect and test in this repository. No proprietary decompiled
implementation is included in BiteDJ. The installed Pi is unchanged by this pass.

## General layout

Rekordbox separates library/export preparation from performance. Its performance
workspace has deck/waveform, browser, mixer, sampler and effect panels. PAD FX
is a configurable performance-pad surface; it is not synonymous with the main
BEAT FX rack. SOUND COLOR FX, Release FX and MERGE FX have their own controls.
The phrase editor and grid editor also share track-preparation UI, rather than
being independent playback clocks. See the [official 6.7 manual](https://cdn.rekordbox.com/files/20230316171900/rekordbox6.7.0_manual_EN.pdf),
particularly its performance-screen and effects chapters.

For our implementation, the useful separation is:

```text
USB database + ANLZ files → library/track data → deck engine → channel mix → output
                                                 ↑              ↑
touch / MIDI → commands and safety checks ────────┘              │
saved Pad FX slot → per-press snapshot → effect / transport state┘
```

This diagram describes BiteDJ integration boundaries. It does not assert an
unverified internal Rekordbox DSP graph or threading model.

| Responsibility | Current BiteDJ home | Decision |
|---|---|---|
| Exported track data, cues, grids, waveforms, phrases | `src/library/rekordbox/rekordboxfeature.cpp`, `lib/rekordbox-metadata` | Reuse existing importer. Respect analysis-source selection and loaded-track guard. Do not create a second analysis clock. |
| Loading and playback safety | `src/mixer/playermanager.cpp`, `src/preferences/systemsettings.cpp` | Keep our existing four loading policies. Do not copy RB enum numbers into them. |
| Touch/MIDI intent | `res/skins/BiteDJ`, `res/controllers/Pioneer-DDJ-FLX6-*` | Keep existing browse, shifted jog/grid and channel-cue quantize bindings. |
| Saved Pad FX choices | **New:** `src/preferences/padfxsettings.*` | Versioned own namespace, per-deck/per-slot defaults and input validation. No config reads on the audio thread. |
| Pad gesture lifetime | `res/controllers/piflex-padfx.js` | Snapshot on press; match release to the physical pad; newest same-lane hold wins; cleanup on unload/shutdown. |
| Effect routing | `src/effects/chains/padeffectchain.*`, `src/effects/effectsmanager.cpp` | Private postfader lanes, separate from user CFX/Beat FX/Merge FX presets. |
| Actual processing | Native Mixxx built-in effects and `PadEchoEffect` | Original adaptation. Similar assignments do not establish identical sound. |

## Deeper binary findings

All addresses below refer only to the hash-pinned `6.7.0.0072` executable in
[the reverse-engineering report](rekordbox67-reverse-engineering.md).

- **Preferences → UI → load guard:** `DeckLoadLock` accessor `0x140988790`
  inserts missing value 1 and migrates old value 3 to 2. This pass followed
  label initializers `0x1400a2bd0`/`0x1400a5150` to the ordered radio labels
  **Lock**, **Unlock** in constructor `0x14090aff0`. Selection instructions
  at `0x14090b415–0x14090b432` select the first for 2 and second for 1.
  Therefore **1 = Unlock, 2 = Lock** in this path. Consumer `0x1409fb800`
  checks per-deck predicates under value 2. One predicate `0x141139500`
  compares state bits against mask `0x110`; their semantic names remain
  unverified. We do not infer our channel-fader safety policy from that mask.
- **Saved pads → dispatch:** reader `0x140c4dc50` and writer `0x140c4d790`
  use deck/mode/pad identity. Dispatcher `0x140c45d20` separates ordinary
  and Release FX behavior. Our preferences likewise stay separate from the
  press/release state machine, but use our own format and IDs.
- **Active effects → selection:** four ordinary slots and a separate release
  slot are constructed; newest matching effect is found by reverse lookup.
  Our current lanes preserve newest-held restoration, but do **not** claim
  the same four-slot eviction semantics. They can combine ten named lanes.
- **Parameters → DSP adapter:** level/depth, room, pitch and color have
  different normalization functions. `30 / 100` at an adapter is **not**
  evidence that native feedback, send or wet mix should be set to 0.30.
  The editor's strength is relative to our conservative native voicing,
  not a mislabeled RB Level/Depth control.

The [6.7 manual](https://cdn.rekordbox.com/files/20230316171900/rekordbox6.7.0_manual_EN.pdf)
contradicts itself about Hold ON/OFF between printed pages 111 and 167. Our
labels say **Momentary** and **Toggle** instead. The pinned release handler
shows zero hold type toggling on press and nonzero hold type stopping on release.
This is static evidence, not a completed live Rekordbox A/B test.

Reproduce:

```sh
uv run --no-project --with pefile --with capstone python tools/research/extract_rekordbox67_settings.py /path/to/rekordbox.exe
uv run --no-project --with pefile --with capstone python tools/research/verify_rekordbox67_pad_flow.py /path/to/rekordbox.exe
```

Both reject a different executable hash. Ghidra decompilation stays in the
local research directory outside this repository; assembly was used to verify
the UI selection branch rather than trusting guessed decompiler types.

## What this update changes

**Settings → Pad FX** edits the 16 currently mapped normal/Shift slots on each
of four decks. It does not add RB's second 16-pad software bank or replace any
controller mode buttons. Assign any supported native preset or Off; override
Echo-family timing from 1/8 to 2 beats; reduce native strength; and choose
Momentary/Toggle for Release Echo. Reset affects only the selected slot.

Transport remains momentary and only one pad owns it at a time. Release Echo
at zero strength is disabled, so it cannot silently gate the dry signal.
Remapping an active pad affects its next press, not its pending release.
STOP ALL PAD FX cancels holds, latches and timers on all decks without writing
volume/play controls or loading a user effect preset. Unloading a track clears
its deck's Pad FX state; no polling loop is added for that.

### Not established / next validation

- Exact DSP transfer curves, decay times, brake/backspin profiles and quantified
  audible equivalence to Rekordbox need listening/captured-audio comparison.
- Full application link, physical FLX6/PFL/main routing and sustained Pi load
  still need validation. Standalone native settings/DSP tests are not that.
- Needle-lock, auto-cue and quantize raw enums are not fully mapped. They are
  research leads, not new settings with invented meanings.
- XDJ-AZ and CDJ-3000 firmware were not investigated in this pass. Shared branding
  does not establish a shared implementation or compatible enum values.
