# Browser ordering and FLX6 pad audit

Date: 2026-09-06. Local source and fixture checks only; the Pi is off.
No device connection, installation, restart, or controller-profile change.

## Browser behavior

Dragging column headings now persists their order using the existing per-model
`header_state_pb` setting. Restoring the serialized order cannot write its own
intermediate moves back into settings. LibraryColumnControl still owns weighted
widths, visibility and internal-column hiding. Dragging column boundaries to
resize is intentionally still disabled; change widths in settings.

Adapted narrowly from TeamDeckshark/bitedj's
[column-order change by Kyohei Okuno](https://github.com/TeamDeckshark/bitedj/commit/2dcb71c0cfc416b601642082adaff35ac081f2d1).
No whole-branch merge or upstream time-mode/navigation changes were applied.

The requested BPM behavior already exists in `WTrackTableView::doSortByColumn`:
sorting retains track identity (playlist position when duplicate occurrences are
possible), selects its new row, and brings it into view. This is a sort of the
current result set, not an exact-140 filter and not a recommendation feature.
No new filter, album-art lookup or More Like This feature was added here.

### Validation

- `os/tests/test_browser_sort.py`: production sorting/restoration methods against
  real Qt6 tables; 200 rows, ascending/descending BPM, 140 BPM neighbors, retained
  selection and viewport visibility, and duplicate playlist occurrences. Passed.
- `os/tests/test_browser_columns.py`: production header methods and actual
  protobuf encoding, real Qt mouse-drag events, reconstruction in a fresh model,
  no writes during restore, model isolation, policy override, corrupt-state
  fallback and unmanaged header compatibility. Passed. Track settings and
  managed-width policy are fixture adapters, not the full SQL application.
- `os/tests/test_search_submit.py` and `test_flx6_workflow.cjs`: passed.
- Extended `src/test/librarycolumncontrol_test.cpp` with the real Rekordbox SQL
  model / LibraryColumnControl restoration regression. This GoogleTest target
  has NOT been built or run in this session.
- Full application build and physical Pi touch/controller tests remain pending.

## CFX Filter

Already present before this change: registered in `builtinbackend.cpp`, compiled
by CMake, and chosen by `getDefaultQuickEffectPreset()`. Its source matches the
reviewed upstream version. Existing saved effect selections remain authoritative;
the presence of this default does not establish the active effect on the offline
Pi. No redundant CFX implementation or profile reset was made.

## Rekordbox FLX6 reference

Pioneer's [FLX6 Rekordbox hardware diagram](https://www.pioneerdj.com/-/media/pioneerdj/software-info/controller/ddj-flx6/ddj-flx6_hardwarediagram_rekordbox_e1.pdf), pages 2-4:

| Mode button | Normal | Shift + mode button |
| --- | --- | --- |
| Hot Cue | Hot Cue | Keyboard |
| Pad FX | Pad FX | Key Shift |
| Beat Jump | Beat Jump | Beat Loop |
| Sampler | Sampler | Sample Scratch |

Hot Cue pads address A-H. Beat Jump's default page gives paired backward/forward
jumps of 1, 2, 4 and 8 beats. Beat Loop lengths are 1/4, 1/2, 1, 2, 4, 8, 16 and
32 beats. Sampler uses slots 1-8 on the left and 9-16 on the right.

Pad FX maps to Effect A-H, or I-P while holding Shift on the pads. The diagram
does **not** name the actual effects in those slots. Shift + the Pad FX *mode
button* selects Key Shift; that is different from Shift + a performance pad.

The [Rekordbox 6.5.1 manual](https://cdn.rekordbox.com/files/20210301182245/rekordbox6.5.1_manual_EN.pdf), printed pages 111 and 166-168, establishes editable per-pad
effects/parameters, two banks, momentary normal effects and separate Release FX
behavior. Different held effects can combine; different beat values of the same
effect use the most recently pressed pad.

The page-111 screenshot shows Sweep, Slip Loop (1/4 and 1/2), Echo, Delay,
Filter LFO, Release Backspin and Release Echo. This is an illustrated software
panel, **not proof of the FLX6 factory pad numbering or today's defaults**.
Do not relabel it as a verified factory mapping. Exact effect-by-pad defaults
still require a clean Rekordbox profile/version check, not a guessed mapping.

## Current BiteDJ mapping mismatch

`Pioneer-DDJ-FLX6.midi.xml` passes a numeric preset index to `padFxPressed`.
`EffectChain::slotControlLoadedChainPresetRequest` loads that position from the
current preset list. Saved ordering and newly imported presets can change what
the same number selects; it is not a stable named-effect assignment.

`padFxPressed` also reuses Merge FX's saved state and QuickEffect rack. It sets
the shared metaknob to 0.75 on starting a pad effect. This is not equivalent to
Rekordbox's independent per-pad effect/beat/amount settings, multiple held
effects, and separate release effects. No claim of sound-equivalent Pad FX.

Next implementation should use stable effect identities, explicit per-pad
parameters and press ownership, plus safe release restoration. Preserve existing
custom mappings or provide an explicit preset choice. Test overlapping holds,
release order, Shift changes while held, deck switching, Merge FX interaction
and disconnect cleanup before changing the live FLX6 profile.

No Pad FX mapping changes were made during this audit.

## Exact Rekordbox 6.7.0 follow-up

The user's reference version is 6.7, not current Rekordbox. Inspected the
[official 6.7.0 manual](https://cdn.rekordbox.com/files/20230316171900/rekordbox6.7.0_manual_EN.pdf),
including rendered pages 111 and 165-167, and statically extracted resources
from the Windows 6.7.0 installer without installing or running Rekordbox.

Installer provenance: the old official CDN link returned HTTP 403. Retrieved
`Install_rekordbox_x64_6_7_0.zip` through the public TousLesDrivers archive
(download record 74565). Windows Authenticode validation of the extracted EXE
returned **Valid**, publisher **AlphaTheta Corporation**. Product version is
`6.7.0.0072`. Installer EXE SHA256:
`EFAE02F460C77880F889F3A12DAC7347BEBDF70C2DC28A826605C1B0FBA0B713`.
No installer execution, application launch, or user-profile reset occurred.

### Confirmed from that version

- Bundled `MidiMappings/DDJ-FLX6.midi.csv` explicitly maps normal performance
  pads to Pad FX 1 slots 1-8 and Shift+performance pads to slots 9-16, all
  described as momentary. Shift+Pad FX mode selects Key Shift.
- Bundled `pad/PadFx1.pad.csv` and `PadFx2.pad.csv` each enumerate 16 slots.
  Neither file names the effects or their default parameter values.
- The manual documents editable effect, beat and parameter values per pad,
  combining different effects, newest-pad priority for different beat lengths
  of the same effect, and a separate Release FX category.
- Page 111 illustrates Sweep 50, Slip Loop 1/4 and 1/2, Echo 1/1, Delay 1/1,
  Filter LFO 4/1, Release Backspin 1/1 and Release Echo 1/8. This is still an
  illustrative panel, NOT a verified factory FLX6 slot table.
- Pages 111 and 167 give contradictory ON/OFF descriptions for the Release FX
  HOLD option. Do not infer its toggle polarity from either passage alone.
- Static application strings identify `PadFxSettings.xml` and fields including
  `fxType`, `fxGroup`, `numerator`, `denominator`, `leveldepth` and `holdType`.
  This identifies the settings schema, not instantiated factory values.
  No matching existing user Pad FX settings file was found under the checked
  local Pioneer/AlphaTheta roaming directories.

Pioneer support also identifies the Pad FX XML as the transferable settings
file in its [official response](https://community.pioneerdj.com/hc/en-us/community/posts/22978671176857-Can-you-save-export-Pad-FX-settings).
Exact factory slot effects/amounts remain unverified; a clean 6.7 profile or
version-proven settings export is required to settle them. Do not substitute
VirtualDJ, Rekordbox mobile, or another controller's historical defaults.

**Update:** the subsequent static analysis below recovers the embedded
missing-settings defaults. It supersedes the unresolved table finding above,
but does not replace live audio testing or identify a user's customized profile.

### Echo complaint: local source evidence, not a sound-equivalence claim

`padFxPressed` forces QuickEffect `super1` to 0.75 and `stopMergeFx` restores
the previous chain preset on release. Reloading the chain discards its echo
history. Additionally, builtin `EchoEffect::processChannel` fades out and
clears the delay buffer when disabling. Thus simply disabling/reloading is
not a tail-preserving release path. A controlled input-send ramp with the
delay still processing is needed if the chosen behavior is natural decay.

The 75% value is a shared metaknob value, not necessarily 75% wet or feedback;
its meaning depends on the selected preset. It is evidence of inappropriate
one-size-fits-all parameter handling, not a measurement of perceived loudness.
The manuals do not establish a precise regular-Echo post-release decay curve.
Release Echo and regular Echo must be treated separately and tested with audio.

No guessed factory preset or DSP change was applied. Pi remains untouched.

## Recovered 6.7.0 default tables (static analysis)

Inspected the publisher-signed application executable itself:
`rekordbox.exe`, SHA256
`94EABBC22ECE732D5D799FBF280F2386BCD8B30348DC303F0F4171C7390DDE53`.
Authenticode returned Valid, AlphaTheta Corporation. No application execution
was needed. The user also authorized installation/running if needed; unused.

### Evidence chain and reproduction

- XML reader at VA `0x140c4dc50` returns false for missing settings/slot.
- Caller at `0x140c428c0`, missing-settings branch `0x140c42947`, selects a
  record with index `modeIndex * 16 + padIndex`, record size `0x58`.
- Standard table base is `0x1441faee0`. An alternate table at `0x1441fb9e0`
  is selected when the context argument is 1. The settings accessor at
  `0x140c4d510` gives that context the `_bg` filename suffix. Do not conflate
  the alternate table with standard Pad FX or invent what `_bg` stands for.
- XML writer at `0x140c4d790` establishes the record fields: group at +0,
  type +4, beat numerator/denominator +0x30/+0x34, room size +0x40,
  pitch shift +0x44, Color FX parameter +0x48, level/depth +0x4c,
  hold type +0x50. Negative-one values are stored sentinels, not percentages.
- Effect-name accessor at `0x140c41810` uses one indexed array for IDs 0-28
  and a separate Release FX array for IDs 29-31. Their static string
  initializers are `0x1402019b0` and `0x140201870`, respectively. Names below
  are resolved from those initializers, not inferred from numeric IDs.
- `tools/research/extract_rekordbox67_pad_defaults.py` reproduces both 32-row
  tables and the name resolution without executing the target. It rejects
  any binary whose SHA256 differs. Run with `uv run --with pefile --with
  capstone python tools/research/extract_rekordbox67_pad_defaults.py PATH_TO_EXE`.
  The binary is not included in the repository.

### Standard bank 1, used by the bundled FLX6 Pad FX slot bindings

Numbers are Rekordbox's stored parameter values, **not equivalent Mixxx wet
mix/feedback percentages**. A separate Color parameter is shown where applicable.
Hardware pads 1-8 select slots 1-8; Shift+pads select slots 9-16.

| Hardware pad | Effect | Beat / other parameter | Level / Depth |
| --- | --- | --- | --- |
| 1 | Roll | 1/2 | 50 |
| 2 | Sweep | Color 80 | Not used |
| 3 | Flanger | 16/1 | 70 |
| 4 | Release Vinyl Brake | 3/4 | Not used |
| 5 | Echo | 1/4 | 30 |
| 6 | Echo | 1/2 | 30 |
| 7 | Reverb | Room size 50 | 30 |
| 8 | Release Echo | 1/2 | Not used |
| Shift+1 | Trans | 1/2 | 50 |
| Shift+2 | Crush | Color 40 | Not used |
| Shift+3 | Filter LFO | 4/1 | 100 |
| Shift+4 | Release Backspin | 4/1 | Not used |
| Shift+5 | MT Delay | 1/8 | 30 |
| Shift+6 | Dub Echo | Color 30 | Not used |
| Shift+7 | Space | Color 30 | Not used |
| Shift+8 | Release Echo | 1/1 | Not used |

### Standard bank 2

Not selected by Shift+Pad FX mode on the FLX6 (that selects Key Shift).

| Slots | Effect | Beat lengths in order | Level / Depth |
| --- | --- | --- | --- |
| 1-4 | Slip Loop | 1/16, 1/8, 1/4, 1/2 | Not used |
| 5-8 | Reverse Roll | 1/16, 1/8, 1/4, 1/2 | 50 |
| 9-12 | Trans | 1/16, 1/8, 1/4, 1/2 | 50 |
| 13-16 | MT Delay | 1/16, 1/8, 1/4, 1/2 | 50 |

The alternate `_bg` table differs in bank 1 slots 1-8 and bank 2 slots 1-8;
the extractor reports it separately. It is not silently substituted here.

Release records store holdType 1; ordinary records store 2. The parameter
label renderer at `0x140c414b0` labels holdType 0 as ON and other values OFF.
That establishes label polarity, not the full MIDI/UI release state machine.

### Scope of this result

This is a recovered, version-pinned default table with a traced fallback path,
not a screenshot guess. No clean-profile GUI or audio A/B test was performed.
No DSP implementation was copied. Matching effect labels and values alone
does not guarantee matching sound, tail behavior, or wet/dry transfer curves.
The existing BiteDJ mapping is unchanged; adaptation still needs implementation
and separate tests before deployment. The Pi was not contacted.

### Existing-repository check (2026-09-06)

Before implementing a new Pad FX controller, inspected these public repositories
through GitHub's contents API (source, not just search snippets):

- [Kentaro1043/Mixxx-FLX4-Mapping](https://github.com/Kentaro1043/Mixxx-FLX4-Mapping),
  revision `d9e7ba7094cda737fea51b26d4f1731b436584e2`: its first eight
  `padFxAssignments` match the recovered factory effect labels/beat values.
  It is not a complete RB6.7 default port: assignments 9-16 substitute different
  effects. It reserves effect units 2/3 for two decks and selects effects by
  numeric positions. `padFxDeactivate` disables the effect immediately on
  release, so it does not solve ordinary Echo pad-release tails. Release Echo
  also writes channel volume, later restoring a saved value; that can conflict
  with intervening fader changes. GitHub reports no license and the inspected
  script header has authors but no license grant. Treat as a behavioral
  comparison, not copy-ready source. Its tests were not run.
- [ElHanko/mixxx-ddj-flx4-mapping](https://github.com/ElHanko/mixxx-ddj-flx4-mapping):
  MIT-licensed, documents custom Pad FX layers and Mixxx 2.6 requirements.
  Its README explicitly requires fixed absolute Beat FX preset positions and
  warns that adding/renaming presets can select the wrong effect. This is not
  evidence of RB6.7 factory equivalence; not a drop-in for our four-deck setup.
- [thesebsterseb/mixxx-flx4-patch-rekordbox](https://github.com/thesebsterseb/mixxx-flx4-patch-rekordbox):
  README describes jog response and Pi tuning, not a Pad FX implementation.
- [Mixxx issue 13260](https://github.com/mixxxdj/mixxx/issues/13260) remains open:
  unassigning a deck cuts Echo output. The issue suggests stopping Send to
  preserve the tail; the linked Actions run is not a verified implementation.
- [Mixxx PR 15985](https://github.com/mixxxdj/mixxx/pull/15985) is merged and fixes
  stereo delay-buffer alignment, not release tails. Our `echoeffect.cpp`
  already calculates `delay_frames` before channel-count multiplication;
  no duplicate backport is needed.

Conclusion: relevant implementations exist, but none inspected supplies the
complete required FLX6 bank, robust tails and four-deck isolation unchanged.
Reuse our existing native DSP and verified upstream fixes; implement only the
missing integration. No third-party mapping code was copied in this check.

Follow-up: [Ghidra inspection of RB6.7 pad scheduling and parameter adapters](rekordbox67-reverse-engineering.md)
records the installed tooling, verified static findings and remaining limits.
