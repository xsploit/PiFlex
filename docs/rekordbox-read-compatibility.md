# Existing Rekordbox exported USBs

Priority confirmed by the user: reliable reading of existing exports, not
writing back to Rekordbox databases or promising support for every format.

The current reader discovers `PIONEER/rekordbox/export.pdb` (also `.PIONEER`),
imports tracks/playlists, and reads DAT beatgrids plus EXT cues/loops when
present, otherwise DAT cues. Device Library is distinct from OneLibrary
(formerly Device Library Plus); exports can contain both. See the
[official Rekordbox FAQ](https://rekordbox.com/en/support/faq/onelibrary-7/).
OneLibrary-only and desktop `master.db` imports are not implemented here.

Changes in this pass:

- DAT-only exports now run both beat and cue passes, rather than skipping beats.
- Retain full 32-bit database page indices; reject out-of-file and cyclic page
  chains before parser seeks. Parse failure reaches the existing scan error path.
- Missing/corrupt analysis produces a warning without preventing audio loading.
  Analysis parsing completes before cue mutation. Corrupt EXT is reported, not
  silently replaced with possibly stale DAT cues; successful independent beat
  data may still be imported. Existing user cue/rating overrides apply afterward.
- Clarify supported export formats in the library's informational view.

## Real export evidence: 2026-09-04

Read-only metadata snapshot from the user's E: FAT32 volume. Private snapshot
and detailed parser report are outside this repository in the parent task's
`artifacts/rekordbox-usb-audit-20260904/`. Do not commit private library data.

Using this checkout's generated C++ parsers, Qt string decoding, and the same
`KS_STR_ENCODING_NONE` setting as its CMake target:

- 602 track records; six playlists; 667 playlist entries.
- All 602 music paths exist on E: and are nonempty; no broken playlist links,
  missing referenced analysis, duplicate track IDs or escaping paths.
- 1,804 analysis files parse: 602 DAT, 601 EXT and 601 2EX. Parsing 2EX proves
  structural readability, not consumption of every tag by the player.
- Preferred cue files contain 160 hot cue entries, five memory entries and
  six loop entries (loops overlap the cue counts).
- One track has only DAT. Two tracks have no exported beats: IDs 239 and 556.
  Missing source beatgrids must not be represented as imported beatgrids.
- Formats: 481 MP3, 108 WAV, seven FLAC, six M4A. Path existence and metadata
  parsing do not prove that every audio file decodes or plays correctly.

The initial read-only Windows check separately reported FAT32 errors and
17,792 KiB in three lost chains. Subsequently, with the user's authorization,
all 3,345 readable files were backed up and SHA-256 verified before CHKDSK
`/F`. Repair recovered three `.CHK` files; the follow-up scan was clean and
Windows reported Healthy. All 3,345 original files retained their exact hashes.
Private backup, manifests and repair logs remain outside this repository at
`../artifacts/usb-E-before-repair-20260904/`.

Reproduce on a private metadata copy with `os/tests/inspect_rekordbox.py`, then
check original audio paths with `os/tests/check-rekordbox-paths.ps1`. Keep the
probe's encoding flags aligned with the application: enabling ICONV would
double-decode UTF-16 and produce false missing-path reports.

Next evidence gate: run the rebuilt application against this real export on
the Pi and verify audible playback, cue/loop behavior and reconnect handling.

## Prepared analysis: implementation versus acceptance

| Export data | Current source support | Remaining boundary |
| --- | --- | --- |
| Tracks, playlists, key | Device Library reader | Full real-export playback test |
| Beatgrids | DAT import; imported grids protected by default from reanalysis | Verify alignment on the Pi |
| Cues and loops | EXT preferred, DAT-only supported | Native cue-engine and audible loop tests |
| Three-band overview/detail | PWV6/PWV7 `.2EX` display adapter; v3 height correction installed on Pi | Same-track visual comparison and broader live-track testing |
| Legacy blue/RGB waveform | Not imported into the display by this change | Native audio waveform analysis remains available |
| Phrase analysis | PSSI import; separate overview row and lower scrolling overlay visible on Pi | Audible alignment and broader live-track testing |
| Guest My Settings | Not applied | Excluded from the current requested scope |

The three-band adapter preserves relative exported mono mid/high/low display
heights, mirrors them into the renderer's channels and keeps the detailed 150 Hz
timebase. It applies the same timing-offset convention as cues. These are not
native stereo RMS measurements and are not persisted as a native RMS cache.
Both overview and detail must validate before either is published. Absent or
invalid data leaves existing waveforms intact or permits ordinary waveform
analysis; it does not invent exported analysis. This is not pixel-identical
Pioneer rendering. Format basis: [Deep Symmetry's ANLZ research](https://djl-analysis.deepsymmetry.org/rekordbox-export-analysis/anlz.html).

Display version v3 fits each complete prepared envelope's shared band peak to
the renderers' 0-255 range, independently for overview and detail. Direct byte
mapping made both views too short (one real track peaked at only 58/255 in the
overview and 125/255 in detail). One fixed factor per envelope preserves band
ratios, silence and relative dynamics; it does not pump gain while scrolling.
This is display normalization, not an inferred audio amplitude or Pioneer's
proprietary transfer curve. Existing skin, waveform mode, visual-gain and zoom
settings are unchanged and remain downstream controls. Native audio analysis
is unaffected. Raw decoding remains available to the forensic byte audit.

`os/tests/test_rekordbox_waveform.py` compiles the actual adapter and tests band
order, unsigned heights, mono mapping, timing offsets, rate conversion, long
1:1 identity, actual Waveform allocation across sample rates, out-of-range
tails, normalization across 1200/30000-column envelopes and all byte heights,
and invalid dimensions. The real-export probe
also compares every decoded detail column against its source bytes across
601 three-band files. These checks do not exercise the actual renderer.

This USB contains `DEVSETTING.DAT` and `djprofile.nxs`, but no `MYSETTING.DAT`,
`MYSETTING2.DAT` or `DJMMYSETTING.DAT`. Those existing files are not substitutes
for a guest performance profile. Rekordbox's desktop export workflow can
prepare My Settings without owning a CDJ; see the [official manual](https://cdn.rekordbox.com/files/20200214194946/rekordbox5.5.0_manual_EN.pdf).
Future guest-profile support must apply only explicitly supported settings,
avoid changing host audio/MIDI configuration, and distinguish ownership when
two guests' USBs are present. No settings-import or OneLibrary parity claim
is made by this change.

## Phrase placement and validation

Placement follows the [official Phrase Edit guide](https://cdn.rekordbox.com/files/20241203210634/rekordbox7.0.5_Phrase_Edit_operation_guide_EN.pdf)
and the user's screenshots: an opaque row below the complete-track overview,
but a translucent lower overlay on the enlarged scrolling waveform. Fill
markers belong only on the enlarged view. BiteDJ retains its existing 80-pixel
clipped waveform area, with a separate 18-pixel phrase row (including a small
gap); it does not hide phrases inside the clipped 160-pixel source widget.

Phrases are session-local display metadata, separate from cue slots, and never
written back to the USB or audio tags. Absolute phrase beat indices resolve
through exported DAT timestamps, including variable-tempo grids and decoder
offsets. Missing phrase analysis clears stale phrases; corrupt analysis retains
the last valid list and reports a warning. An invalid optional fill does not
discard otherwise valid phrases. Numeric high-mood phrase variants and exact
Pioneer font/fill-pattern parity are not yet implemented.

The real export decoded 7,757 phrases from 474 PSSI files with zero analysis
failures. Two invalid optional fill markers were omitted. Local tests cover
masked/unmasked PSSI, bounds, timing, importer error behavior, QPainter drawing,
the skin's separate row, and actual Mesa OpenGL shader drawing, labels, texture
reuse, seek clipping and unload behavior. These do not replace live Pi playback
and alignment checks. Reproduce with `os/tests/test_rekordbox_phrases.py`,
`test_phrase_layout.py`, and `test_phrase_gl.py` under Linux with Qt6 and Xvfb.
Parser, adapter and drawing fixtures also run with `-O2 -ffast-math`, matching
the release build's floating-point assumptions. External-input validation uses
the existing separately compiled `util_isfinite` boundary rather than
`std::isfinite`, which those flags can optimize away. The release-flags audit
again parsed all 1,804 real analysis files with no failures.
