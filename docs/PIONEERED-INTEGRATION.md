# Pioneered presentation integration

Reference: [ntamas94/pioneered-by-ntamas](https://github.com/ntamas94/pioneered-by-ntamas/),
commit `db9b669f1cb2fa24f9316cfde855e1e2c6643449`.

This is a selective adaptation, not a wholesale repository merge. The useful
first step is consistent presentation without replacing working analysis or
reducing the space available to two decks.

## Included

- **Consistent frequency palette:** the default skin's overview and scrolling
  views use the same low/mid/high colors. This is most apparent in Filt mode;
  RGB still uses its existing frequency-mixing renderer. No amplitude curves,
  analyzer filters, EQ behavior, or imported analysis bytes are changed.
- **Scrolling titles/artists:** opt-in `<Elide>scroll</Elide>` for `WLabel`.
  Overflowing plain text scrolls at 30 logical pixels/second, with 1.5-second
  pauses at the beginning and end. Hidden/fitting labels stop their timers.
  Theme palettes, CSS frames, and clipping remain in use; long names do not
  enlarge the deck layout. Other labels retain their existing elision behavior.
- **Per-deck time display:** `WNumberPos` accepts an optional `ModeConfigKey`.
  The BiteDJ skin binds it to persistent `[PiFlex],time_mode1` through `4`.
  Left-click/tap toggles elapsed/remaining; both responsive readout sizes share
  the same deck control. Invalid/missing custom controls retain the legacy
  global setting. Skins without this option are unchanged.
  This toggle belongs to the Play-view numeric readout, not the compact overview
  countdown overlay used while browsing/settings; that overlay stays remaining.

The existing two-deck view, 80-pixel waveform overview and separate 18-pixel
phrase strip are preserved. Four persistent time keys do **not** mean a new
four-deck layout has been implemented.

## Deliberately not included

- Experimental crossover frequencies, per-band gain/gamma, envelope algorithms,
  or claims of matching Pioneer hardware. Native Mixxx analysis and Rekordbox
  PWV6/PWV7 display envelopes are different inputs; a calibration measured for
  one is not evidence for applying it to the other.
- Scratch-timer changes and renderer resize delays without a reproduced PiFlex
  fault and before/after timing tests.
- A four-deck skin, stems routing, or controller remapping. These need coordinated
  layout, focus, and controller testing, not just extra deck widgets.
- Extra rulers/overlays that consume the phrase row or reduce waveform height.

Rekordbox beatgrids, cues, phrases and waveforms continue through the existing
import path. Missing analysis is not fabricated to fill a display.

## Checks

On Linux/WSL with Qt6 development packages:

```sh
python3 os/tests/test_deck_presentation.py
python3 os/tests/test_phrase_layout.py
python3 os/tests/test_rekordbox_waveform.py
python3 os/tests/test_rekordbox_phrases.py
python3 os/tests/test_phrase_gl.py
```

The presentation fixture runs production painting/mouse/timing methods with
fixture skin lookup and control transport. It checks light/dark text pixels,
timer lifecycle, size behavior, independent deck controls and legacy fallback.
This does not substitute for a full application build or Pi touch/playback test.

### Verification recorded September 4, 2026 (Pacific)

- All five commands above passed. Current `wlabel.cpp`, `wnumberpos.cpp` and
  `tooltips.cpp` also passed Linux/Qt6 syntax checks.
- The complete native ARM64 build linked successfully and was installed using
  the checked update/rollback workflow. Installed code revision:
  `5b6b404d2e36a471e05bbcf2e43c771a0bb43729`.
- Installed executable SHA-256:
  `ba58f0d6e4ee248c3293b6c0aca641a06e333f6648c09054342c70f516ac3b4b`.
- The Pi rendered a loaded track with the large two-deck layout intact;
  `pflx-session` and `pflx-edmc` were active, the FLX6 PCM stream was RUNNING,
  and bidirectional MIDI connections were present.
- Per-deck switching and marquee lifecycle/color correctness passed Qt fixtures.
  Physical touch testing and a sustained loaded-audio/xrun qualification are
  **not** claimed. Live UI interaction was stopped when concurrent use was seen.
- The package's dirty flag reflects pre-existing untracked screenshots; tracked
  application sources were committed before packaging. Subsequent documentation
  changes do not require rebuilding the installed binary.
