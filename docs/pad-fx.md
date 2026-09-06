# FLX6 Pad FX

The default layout follows the statically recovered Rekordbox 6.7.0 bank-one
table. [Research and source provenance](browser-columns-and-flx6-pad-audit.md)
records the exact binary and the existing repositories inspected first.
Implementation is native Mixxx/BiteDJ DSP, not copied Rekordbox DSP.

| Pad | Normal | Shift |
|---|---|---|
| 1 | Roll 1/2 | Trans 1/2 |
| 2 | Sweep 80 | Crush 40 |
| 3 | Flanger 16 | Filter LFO 4 |
| 4 | Release Vinyl Brake 3/4 | Release Backspin 4 |
| 5 | Echo 1/4 | MT Delay 1/8 approximation |
| 6 | Echo 1/2 | Dub Echo 30 approximation |
| 7 | Reverb 50 | Space 30 approximation |
| 8 | Release Echo 1/2 | Release Echo 1 |

Numbers in labels describe the reference assignment, not a claim that native
parameter values reproduce Rekordbox's transfer curves. Echo uses a conservative
0.22 input send / 0.38 feedback, instead of the old blanket 0.75 superknob.
Crush uses 10 bits and 0.45 downsampling. These require listening calibration.

## Implementation boundaries

### Saved editor

Open **Settings → Pad FX** and choose the deck and Normal or Shift bank. Eight
large pad cards follow the controller's 4×2 layout. Each has direct dropdowns
for assignment, timing, strength and Release Echo behavior, plus its own reset.
Effect families use labeled color accents, rather than making every pad blue.
The panel scrolls when the screen is too small, rather than increasing
the minimum size of the rest of the skin.

- Assignment: the 16 native presets listed above, plus Off.
- Echo/delay timing override: default, 1/8, 1/4, 1/2, 3/4, 1 or 2 beats.
  This does not change transport duration, Flanger rate, Trans rate or LFO rate.
- Strength: 0/25/50/75/100% of our native voicing. Zero disables the pad.
  For nonzero transport settings the transport curve is unchanged. For DSP it
  reduces the relevant send, mix, depth, crush severity or filter excursion;
  it does not increase feedback or claim to reproduce RB's Level/Depth curve.
- Release Echo: Momentary or Toggle. Other effects, including brake/backspin
  and roll, remain momentary so a saved toggle cannot latch scratch controls.
- Reset selected pad restores only that slot. STOP ALL PAD FX clears all
  decks, including active latches and scheduled cleanup/capture/LFO callbacks.

`PadFxSettings` owns persistent values in `[PadFX_v1]`: `dN_sS_effect`, `_beat`,
`_strength`, `_hold`, with 1-based decks and 0-based slots. It exposes these
through `[PadFX]` controls and an editor selector. The numeric assignment IDs
are our append-only catalog, not RB's enums. Unknown future config namespaces
are left alone. Invalid current values use defaults or reject the write.
Configuration is saved through the normal application preferences machinery.

The mapping reads a **snapshot** only on note-on. Editing or resetting that
slot while held does not redirect its eventual note-off. Track unload clears
its deck's state through an event subscription; no polling is introduced.

### Runtime

- `res/controllers/piflex-padfx.js` owns pad holds, per-deck timer lifetimes,
  and named parameter settings. The controller XML loads it before the FLX6
  mapping; both files must be installed together with the updated application.
- `PadEffectChain` supplies private postfader lanes for each deck. Existing CFX,
  Beat FX, Merge FX, presets, mixer volumes and playback switches are untouched.
  Lanes address effects/parameters by stable manifest ID, not list position.
  No pad-lane state is persisted to `effects.xml`.
- DSP is warmed when the mapping initializes, not allocated every pad press.
  Missing effects fail closed with a diagnostic instead of selecting some other
  effect. Old application builds do not acquire these lanes from a mapping alone.
- Different effect lanes combine. The latest held pad on the same lane wins;
  releasing it restores the previous still-held pad. Note-off is associated
  with the physical pad even if Shift has since changed.
- Ordinary Echo/Reverb release sets Send to zero and keeps the lane processing
  its buffer. Echo has a conservative 48-second cleanup bound (allowing tempo
  changes to extend the native delay); Reverb/Space use 12 seconds. Retriggering
  cancels stale cleanup timers. Shutdown cancels all timers and disables lanes.
- Release FX cancels other Pad FX on that deck. Release Echo captures a segment,
  then gates its own dry/input paths; pad release restores dry audio while the
  stored echo decays. `PadEchoEffect` subclasses the existing Echo DSP and adds
  only a sample-ramped dry amount. Ordinary Echo remains unchanged.
- Roll is a native temporary loop roll. Brake/backspin use bounded-duration
  scratch-rate curves with slip enabled temporarily, restoring scratch/slip
  state on release. They never write `play` or `volume`. These are not measured
  replicas of Rekordbox's transport curves.
- Sweep is a band-pass filter approximation; Trans is square-wave Tremolo;
  Filter LFO is a four-beat log-frequency sweep with 33-ms parameter updates.
  MT Delay/Dub Echo use separate Echo lanes; Space uses Reverb. These do not
  recreate the proprietary algorithms, despite matching the reference layout.
- These run postfader so they receive the engine's beat metadata. Lowering a
  channel fader reduces new input; an existing tail can continue. Prefader
  processing currently supplies an empty feature state and cannot tempo-sync
  these native effects. PFL/main routing still needs end-to-end testing.

## Validation

Local checks:

```sh
node --check res/controllers/piflex-padfx.js
node os/tests/test_padfx.cjs
node os/tests/test_flx6_workflow.cjs
python3 tools/research/check_padfx_compile.py /path/to/existing/linux-build --audio --settings --skin
```

The last command uses an existing configured build's dependency flags/libraries
without modifying that build. It syntax-checks all changed C++ translation units
and compiles/runs the current Echo source with `os/tests/padecho_audio_test.cpp`.
`--settings` exercises real ConfigObject/ControlObjects, including disk reload;
`--skin` parses the actual editor with the native skin parser and clicks it
under Xvfb. The UI test wraps only this panel, not a complete DJ session.
This is not a full application link or end-to-end controller test.

Results on the local WSL build dependencies:

- All 64 normal/shifted pad routes are present, with no duplicate MIDI routes.
- Four-deck holds, same-lane restoration, cross-Shift release, duplicate presses,
  tail/retrigger cancellation, missing backend and shutdown tests pass.
- Existing FLX6 browse/jog/Beat FX controller regressions pass.
- Editor/controller tests cover assignment snapshots, remapping while held,
  per-deck isolation, bounded timing, reduced strength, toggle release, panic,
  unload cleanup, invalid values and simultaneous transport ownership.
- The native settings test checks editor/direct-control synchronization,
  real disk round-trip, repeatable selected-slot reset and preservation of
  unknown future namespaces. Validation uses `util_isfinite`, because the
  release build's fast-math flags invalidate ordinary inline `std::isfinite`.
- The native grid test exercises actual dropdowns across all 64 assignments,
  deck/bank isolation, reset, external control updates, contextual timing/hold
  options, repeated emergency stop and small-window scrolling.
- Current native Echo DSP passes impulse tail/decay, dry gate/restore, finite
  output and output guard checks at 44.1/48 kHz and 32/256/1024-frame buffers.
- Corrected an existing `<= numSamples` loop to `< numSamples` in the shared
  add-dry path, which the Reverb lanes use. The surrounding engine has been
  syntax-checked, not sanitizer-tested end-to-end.

### Physical-pad investigation (2026-09-06)

Live ALSA capture confirmed normal-bank pads 1–8 transmit notes 16–23 on MIDI
channels 7 and 9 (zero-based), including releases, matching both deck mappings.
An integration test then exposed a separate audio-routing defect:
`EffectSlot::setEnabled()` changed its own ControlObject without publishing to
DSP. Self-originated ControlObject writes suppress `valueChanged`, so the
already-loaded private effects stayed bypassed while the transport brake worked.
The setter now explicitly updates the engine when its value changes.

`check_padfx_compile.py <build> --harness-only --routing` runs the real
ControlObject → PadEffectChain → EffectSlot → EngineEffectsManager path with
generated audio, without opening an audio device or touching a DJ profile.
Before the fix, bypass/enabled/released energy was 624/624/624; after the fix,
it was 624/0.00646588/624 for an 8 kHz tone through a 500 Hz low-pass filter.
The test asserts both activation and release, beyond the separate UI, mapping
and DSP-unit tests. Listening A/B with Rekordbox, remaining physical Shift/jog
interactions, and sustained Pi CPU/memory/xrun testing remain acceptance checks.
