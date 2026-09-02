# CDJ and XDJ-RX feature reuse map

This document tracks reusable open-source work for making PiFlex feel familiar
to CDJ and XDJ-RX users. It intentionally separates source-engine features,
touchscreen presentation, controller mappings, and appliance/OS work. Importing
an entire fork would mix those concerns and discard BiteDJ-specific reliability
work.

## Conclusion

There is no maintained Mixxx fork that already provides the complete target:
Pioneer-style library preparation, phrase analysis, traffic-light browsing,
full-track media-loss protection, controller-first preview, and an embedded Pi
appliance. BiteDJ remains the strongest base for PiFlex. The useful work is
distributed across several projects and should be imported feature by feature.

## Primary sources

### TeamDeckshark/BiteDJ

Source: <https://github.com/TeamDeckshark/bitedj>

Keep as the upstream product base. It already supplies the touchscreen shell,
USB/Rekordbox/Serato integration, removable-media stores, audio-path recovery,
device settings, and appliance behavior that generic Mixxx forks do not have.

### loopcreativeandy/mixxx-custom

Source: <https://github.com/loopcreativeandy/mixxx-custom/tree/andy-custom>

This is the most useful feature donor found in the fork network. Do not merge
the branch wholesale. It is heavily customized and more than one thousand
commits behind current Mixxx main, but several isolated commits are useful:

| Candidate | Commit | PiFlex use |
| --- | --- | --- |
| One-touch/automatic key match | [`fc46ae3d`](https://github.com/loopcreativeandy/mixxx-custom/commit/fc46ae3d66e61969ddad92d11afb64a954feeb93) | Reuse the existing `sync_key` control. Keep automatic-on-load optional. |
| Harmonic clash warning | [`71407f49`](https://github.com/loopcreativeandy/mixxx-custom/commit/71407f49b01d09d60197f6ae5c856cdf17e282dd) | Starting point for deck compatibility indication. Replace its Zouk-specific naming and eventually extend it to library traffic lights. |
| Smart Playlists | [`b6b8d4e1`](https://github.com/loopcreativeandy/mixxx-custom/commit/b6b8d4e197dc0fc06888227b34a98903f33c6fc3) | Saved searches can become PiFlex smart crates. This is not a substitute for the temporary Prepare/Tag List. |
| Audio jitter trace | [`dc68f015`](https://github.com/loopcreativeandy/mixxx-custom/commit/dc68f015) | Useful for distinguishing late callbacks from callbacks that run too long during the zero-xrun proof. |
| Movable preview deck | [`90fc35d3`](https://github.com/loopcreativeandy/mixxx-custom/commit/90fc35d3) | Design reference only. BiteDJ needs a smaller controller-first preview strip rather than the AndyVideo layout. |

### ghztomash/StandaloneMixxx and Mixxx fork

Sources:

- <https://github.com/ghztomash/StandaloneMixxx>
- <https://github.com/ghztomash/mixxx/tree/rekordbox-fixes-integration>

The custom branch contains eleven Rekordbox/library/controller commits covering
duplicate paths, played markers, loaded-track highlighting, Rekordbox waveform
and cover-art rendering, configurable track colors, and jog filtering. Most of
that behavior is already present or superseded in BiteDJ. Compare individual
commits when fixing a matching bug; do not merge the branch.

### timewasternl/Pioneered

Source: <https://github.com/timewasternl/Pioneered>

Useful as a visual and interaction reference for a compact Pioneer-style skin.
PiFlex already imports the useful main-view direction. Continue extracting
small layout ideas rather than replacing BiteDJ's touch-first skin.

### marcmonka/XDJ100SX

Source: <https://github.com/marcmonka/XDJ100SX>

Useful appliance reference. Its most interesting feature is sharing a second
player's USB over the network so it appears under Rekordbox. That could become a
future "PiFlex Link" experiment, but it is not a replacement for Pro DJ Link and
should not enter the live build until local playback is fully proven.

### fayaaz/mixxx-pi-gen

Source: <https://github.com/fayaaz/mixxx-pi-gen>

Useful OS-build comparison. It uses Raspberry Pi OS, Sway, OpenGL waveforms,
the performance governor, and `preempt=full`. PiFlex already pursues the same
class of appliance optimization with BiteDJ, EDMC, the FLX6, and the official
10-inch display as explicit targets.

### acolombier/mi3x

Source: <https://github.com/acolombier/mi3x/tree/feat/qml>

Active QML/UI development work, not a ready touchscreen product. Watch it for
future upstream UI architecture. Merging its branch now would be a large and
unrelated migration.

## Feature-by-feature decision

| PiFlex feature | Existing foundation | Decision |
| --- | --- | --- |
| One-touch Key Match | Stock Mixxx `sync_key`; Andy CP35 demonstrates it | Expose directly in BiteDJ first. Automatic match remains optional. |
| Traffic-light keys | `KeyUtils::getCompatibleKeys()` and Andy CP36 | Build a generic reference-deck selector and color compatible library keys. Do not copy the hard-coded Zouk rule. |
| Prepare/Tag List | Mixxx playlists/crates | Add a dedicated temporary, controller-friendly list. Smart Playlists solve a different problem. |
| Smart crates | Andy CP68 | Port after Prepare List and rename/configure it for PiFlex. |
| Touch/controller preview | Stock PreviewDeck and Andy CP74 layout ideas | Build a compact hidden-until-playing preview strip with an explicit start/stop action. |
| Whole-track protection | BiteDJ re-open grace and chunk cache | New PiFlex work. No suitable fork implementation was found. |
| Emergency loop | Mixxx looping engine | New PiFlex recovery policy. No suitable fork implementation was found. |
| Phrase analysis/display | BiteDJ drop/downbeat analysis | New analysis and UI work. No suitable fork implementation was found. |
| Phase meter | Upstream issue `mixxxdj/mixxx#5852` | Follow upstream design, but expect PiFlex implementation work. |
| Rekordbox fidelity | BiteDJ plus ghztomash branch | Compare bug by bug; do not replace BiteDJ's removable-media model. |
| Audio proof tooling | Andy CP71 and BiteDJ underrun accounting | Port the lock-free trace before the final two-deck stress campaign. |
| PiFlex Link | XDJ100SX network USB sharing | Research only after local reliability and media-loss protection are complete. |

## Implementation order

1. Expose one-touch Key Match in BiteDJ.
2. Add controller-first preview start/stop and a compact preview strip.
3. Add Prepare/Tag List and make All Tracks behavior explicit.
4. Add harmonic library traffic lights with a selectable reference deck.
5. Port audio jitter tracing, then complete the zero-xrun stress matrix.
6. Add whole-track protection and emergency recovery.
7. Port Smart Playlists as optional smart crates.
8. Improve beatgrid, active-loop, and Rekordbox round-trip fidelity.
9. Add phrase/phase presentation.
10. Explore PiFlex Link and other multi-player features.

## Firmware research boundary

Running Pioneer or AlphaTheta firmware on unrelated hardware is a separate
research project, not a PiFlex implementation shortcut. Start with lawful
inspection of user-obtained firmware, published update formats, hardware and
boot dependencies, and clean-room behavior documentation. Prefer reproducing
the user-visible workflow in open code. Do not make PiFlex depend on proprietary
firmware, copied assets, signatures, keys, or bypassed platform checks.
