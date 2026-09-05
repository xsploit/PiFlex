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
