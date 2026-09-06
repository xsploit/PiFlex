# Rekordbox settings research

2026-09-06 follow-up to the [Pad FX binary analysis](rekordbox67-reverse-engineering.md).
Scope: learn settings behavior for BiteDJ, not copy proprietary implementation
or replace the current preferences with raw Rekordbox enum values.

## Verified in the 6.7.0.0072 binary

The named strings were traced through their global string initializers into
actual preference accessors. These accessors check whether the key exists,
insert a default only when absent, and read the saved value. Raw defaults were
read from the PE image and cross-checked against the accessor instructions.

| Key | Raw missing-setting default | Accessor virtual address |
|---|---:|---|
| `DeckLoadLock` | 1 | `0x140988790` |
| `DeckNeedleLock` | 1 | `0x140988ac0` |
| `AutoCueLeveldB` | 5 | `0x140985810` |
| `DeckQuantizeMode` | 2 | `0x14098ac50` |

These are internal settings values. A later same-day trace established
**DeckLoadLock 1 = Unlock, 2 = Lock** via its radio-button label initializers
and selection branch; see [the system map](rekordbox-system-map.md). The other
three remain **not fully mapped user-facing choices**.
In particular, `AutoCueLeveldB = 5` does not establish a +5 dB threshold.
Likewise, quantize mode 2 does not establish a two-beat interval.

`DeckLoadLock` has a concrete compatibility migration: when its stored value
is 3, the accessor writes 2 and returns 2. This was checked at instruction
addresses `0x140988836`, `0x140988848`, and `0x140988878`. This is evidence of
explicit old-value handling, not permission to copy that migration into ours.
Their enum values and our enum values are different contracts.

A consumer at `0x1409fb800` branches on the load-lock choice and consults
per-deck state. The meanings of its three downstream state predicates have
not been established; no claim is made that it matches our fader-down rule.

## Pad FX settings structure

The writer at `0x140c4d790` and reader at `0x140c4dc50` operate on the
`PadFXSettings` root and `PADFXINFO_500` entries. The writer finds/removes an
existing entry matching `deckNo`, `modeIndex`, and `padIndex`, then appends the
replacement. It accepts mode indices below 2.

Stored fields include effect group/type, editable parameter types, beat
numerator/denominator, room size, pitch shift, color, level/depth, hold type,
and display color index. The writer stores `inherited` as zero in this path;
that does not establish the behavior of all inheritance paths.

Practical takeaway: an editable, per-deck/per-bank pad setup with rational
beat lengths and explicit hold mode is a better target than hard-coded
effect names and one generic intensity slider. Importing RB settings would
still need a supported-effect translation layer and safe handling for
unknown fields, unsupported effects and sentinel values such as -1.

## What already exists in BiteDJ

`src/preferences/dialog/dlgprefdeck.cpp` already exposes four loading policies:
reject, allow and stop, allow and play from load point, and allow only with the
channel fader down or main mix off. Do not add a duplicate load-lock setting.
The FLX6 mapping already has a quantize toggle on Shift + channel cue.

The most useful implementation candidates after behavior validation are:

1. Expose existing deck safety/quantize controls consistently in the Pi UI.
2. Add a versioned native Pad FX preset editor rather than copying RB's enums.
3. Compare auto-cue and needle/search safety against existing engine behavior
   before deciding whether new controls are needed.
4. Maintain named, tested migrations for our own saved settings and preserve
   existing choices when adding defaults.

That list described the initial research pass. The subsequent implementation
adds the versioned native Pad FX editor; see [Pad FX](pad-fx.md) for its scope
and tests. Existing load-lock and quantize controls were retained, not duplicated.
The Pi installation remains unchanged.

## Reproduce and limitations

```sh
uv run --with pefile --with capstone python tools/research/extract_rekordbox67_settings.py /path/to/rekordbox.exe
```

The extractor pins the same SHA-256 as the Pad FX research, checks key bytes,
default constants and migration instructions, and outputs original metadata
only. Ghidra output remains outside the repository. Decompiler-inferred return
types can be wrong (several getters were shown as void even though assembly
returns a value in EAX); conclusions above were checked against instructions.

The broader hardware target is **XDJ-AZ**, with CDJ-3000 as an additional
standalone-player reference. The earlier FLX6 firmware assessment is not a
conclusion about either of those devices. Their firmware and prior community
reverse-engineering work remain a later investigation, as requested.
