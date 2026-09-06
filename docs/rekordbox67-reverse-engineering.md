# Rekordbox 6.7 Pad FX: static reverse-engineering pass

Date: 2026-09-06. Purpose: characterize controller/effect behavior for an
independent BiteDJ implementation. This is not a recovered Rekordbox source
tree or a claim of sound-equivalent DSP.

## Tooling and scope

Ghidra 12.1.3 is installed and tested in WSL Ubuntu at
`/opt/ghidra_12.1.3_PUBLIC`, with Ubuntu OpenJDK 21 JDK. The official release
archive matched SHA-256
`93a5d11a9ad510622acaaf908c556a7b9b764d338e78a7567f3689bf5081fd54`.
[Official Ghidra releases](https://github.com/NationalSecurityAgency/ghidra/releases).
Direct headless scripting works; no MCP server was needed or configured.

Target: signed Windows `rekordbox.exe` 6.7.0.0072, 72,365,720 bytes, SHA-256
`94eabbc22ece732d5d799fbf280f2386bcd8b30348dc303f0f4171c7390dde53`.
Image base: `0x140000000`. The scripts refuse other hashes.

Twenty-nine selected functions were decompiled during this pass. The local
Ghidra project and generated output live under `/root/research/rb670`, outside
this repository. The EXE was parsed, not launched, patched or attached to.
No controller firmware was flashed; no Pi connection or deployment occurred.
Only original inspection scripts and behavioral notes belong in this repo.

## Findings

| Behavior | Static evidence | Consequence for BiteDJ |
|---|---|---|
| Four ordinary slots plus a separate Release FX slot | Constructor `0x140c3db20` creates four ordinary objects indexed 0-3 and a different object indexed 4 | Our ten fixed native lanes are not an exact replica of RB's slot allocation |
| Most recently pressed pad of the same effect takes precedence | `0x140c43b20` handles activation; `0x140c465e0` searches the active list backwards by effect type | Preserve ordered holds, not a single boolean per effect |
| Releasing the newest same-effect pad restores the earlier active one | `0x140c44010` removes the released entry, finds its predecessor and transfers parameters through `0x140c44670` | Our previous-hold restoration has a concrete reference basis |
| A new effect type can evict existing effects when the active distinct-type count exceeds three before insertion | Unique-type counting/eviction loop in `0x140c43b20` | Do not describe unlimited combinations of our lanes as factory-equivalent; runtime edge cases still need testing |
| Release FX uses a separate press/release state machine | `0x140c45d20` dispatches group 3 to `0x140c45fe0`; start/stop routines carry the literal labels `startReleaseFx` / `stopReleaseFx` | Do not treat Release Echo as an ordinary Echo pad with more wet gain |
| Release hold type 0 ignores note-off and toggles on subsequent presses; nonzero starts on press and stops on release | Hold field at runtime object +0x58, branches `0x140c460cb` through `0x140c460f9`; factory release entries use 1 | Factory Release FX is momentary; optional latching is a distinct mode |
| Starting a prepared Release FX slot clears ordinary active Pad FX | Group-3 allocation branch in `0x140c436c0` stops non-release entries and clears the active list | Our clearing of other Pad FX is supported; initialization/callback timing is not fully traced |

The four-slot constructor and eviction logic agree, but these are static
findings, not proof of every live multi-pad/loop interaction. In particular,
Slip Loop has a separate path and Release FX has its own allocation/handler.

### Parameter normalization, not DSP equivalence

The runtime pad object has an 8-byte prefix before the settings record. For
example, runtime +0x54 is stored `leveldepth` (+0x4c in the defaults table).
Confusing these layouts would misidentify pitch shift as effect depth.

| Stored field | Adapter sent to RB's effect layer | Routine |
|---|---|---|
| Level/depth | value / 100 | `0x140c444f0` |
| Room size | (value - 1) / 99 | `0x140c445a0` |
| Pitch shift | (value + 100) / 200 | `0x140c44550` |
| Color, effect IDs 23 or 24 | value / 100 | `0x140c445f0` |
| Color, other types | (value + 100) / 200 | `0x140c445f0` |

Consequently the default Echo depth 30 becomes 0.30 at this interface. This
does **not** establish 30% feedback, a 30% send, or the same dry/wet curve as
Mixxx. Default Sweep color 80 becomes 0.90, not 0.80. Exact filter ranges,
feedback curves and saturation remain inside the downstream DSP and have not
been recovered. No native sound parameters were changed based on this table.

The effect-off wrapper `0x141840600` sets an active flag to zero; the on wrapper
`0x141840640` sets it to one. This alone does not tell us whether a downstream
effect drains or clears its delay buffer. Echo-tail timing and brake/backspin
speed envelopes remain unverified.

## Reproduce

With a local copy of the exact binary, from the repo:

```sh
uv run --with pefile --with capstone python tools/research/verify_rekordbox67_pad_flow.py /path/to/rekordbox.exe
```

The verifier checks the image hash, key instructions, float constants, and
factory release hold values. The existing `extract_rekordbox67_pad_defaults.py`
independently extracts both default tables. Neither executes the target.

For a fresh Ghidra project, create an output directory outside this repo and
use the installed headless launcher:

```sh
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \
/opt/ghidra_12.1.3_PUBLIC/support/analyzeHeadless /path/to/project-directory rb670 \
  -import /path/to/rekordbox.exe -noanalysis -max-cpu 4 \
  -scriptPath /path/to/PiFlex/tools/research \
  -postScript InspectPadFx.java /path/to/local-research-output \
  0x140c3db20 0x140c43b20 0x140c44010 0x140c45fe0 0x140c444f0
```

For an existing project use `-process rekordbox.exe` instead of `-import`.
`InspectPadFx.java` uses PE exception ranges and explicitly traced leaf targets;
it does not run full auto-analysis. Some decompilations contain misleading
call-to-branch/unreachable-block warnings around import wrappers. Validate
those paths against disassembly, not the generated C alone. The release hold
branches above were checked directly with Capstone for that reason.

## Firmware assessment

The [official FLX6 firmware article](https://support.alphatheta.com/en-US/articles/12496273998105)
lists Windows firmware 1.12, dated June 6, 2023, with a TRAKTOR PRO 3 fix.
Its linked download redirected to an HTML help page during this pass: the
downloaded file was 103,483 bytes and failed ZIP validation, versus the listed
1,481,699 bytes. No usable firmware image was obtained or analyzed.

Rekordbox is the better-supported target for the current Pad FX task: we have
direct evidence of its software-side pad scheduling and parameter dispatch.
Firmware could help future USB/MIDI/controller investigations, but there is no
evidence here that it contains the Rekordbox DSP we want to match.

## Remaining work

- Controlled audio A/B: ordinary Echo release, Release Echo, Crush and Sweep.
- Trace downstream DSP only where a measured discrepancy warrants it.
- Decide whether strict four-slot compatibility should replace our fixed-lane
  behavior; do not silently change concurrency from static findings alone.
- Full application, physical FLX6 and Pi performance tests from
  [Pad FX validation](pad-fx.md#validation) remain required.

No application DSP/mapping changes, commits or pushes were made in this
reverse-engineering pass.
