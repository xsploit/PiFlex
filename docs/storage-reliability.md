# Storage reliability changes and release gates

Implementation checkpoint: 2026-09-04. Companion and native-client changes are
included in the repository. Source publication does not deploy an application
bundle or certify hardware acceptance; the latest storage changes still need
the Pi checks below. This is not a claim of complete Rekordbox compatibility.

## Destination policy

- Enumerate mounted block filesystems under `/media` and `/run/media`.
  A writable directory alone is never accepted as a USB destination.
- Remember filesystem UUID plus selected root. Mount-instance identity detects
  unplug/replug during a job. Without a UUID, selection expires across mount
  instances or reboot instead of trusting a reused `/dev/sdX` name.
- SD fallback is an explicit setting, enabled by default, using the companion's
  `dataDir/sd-library`. The setup/status UI names the actual destination and
  explains fallback. A missing remembered USB does not prevent server startup.
- Returning to the remembered USB restores it as the destination for subsequent
  jobs. No files or partial downloads are silently migrated between volumes.
- A job pins its destination via a Linux directory descriptor and accesses it
  through `/proc/self/fd`. Removal fails/cancels that job; it cannot continue
  writing into the SD-backed empty mountpoint. New jobs may use explicit SD.
- Keep a 256 MiB free-space reserve, check known download size before writing,
  and recheck during streaming. This is an allocation guard, not a filesystem
  quota or a guarantee against other processes consuming free space.
- Validate and reconcile before committing a destination change. Reject drive
  switches while downloads are queued/running. Multiple mounted USBs remain
  separately selectable; existing downloads retain their source identity.
- Reconcile indexed files before treating a download as already complete, then
  restore its Load/Preview association. The native loader checks the recorded
  volume identity and file existence, not the currently selected destination.

## Eject

Use the existing Settings > System drive list and its two-tap Eject control.
Before the existing unload/save/unmount sequence, ask EDMC to exclude that
volume, cancel its active download and release the pinned directory. A failed
unmount cancels the exclusion. Other USBs are not ejected. Never force/lazy
unmount from this workflow. Companion coordination is bounded to five seconds;
timeout fails eject safely and permits retry. Companion absence is acceptable
only for connection refusal; normal unmount still enforces filesystem busy
checks. General EDMC HTTP replies have a ten-second timeout.

## Automated evidence

Run from `edmc-companion`: `node --test`.

2026-09-04: Linux/WSL: all 51 Node checks passed in the publication pass.
The preceding Windows run passed 49 with two Linux-only skips. Cases include
missing saved USB, writable empty mount
directory, two drives, invalid selection, active download switching, stale
indexes, duplicate-download state, eject during real HTTP streaming, free-space
reserve, and Linux pinned-path replacement. Mount discovery is injected in
these fixtures; they are not physical USB-removal tests.

Linux commands from repository root:

```sh
python3 os/tests/test_update.py
python3 os/tests/test_native_storage.py
python3 os/tests/test_rekordbox_safety.py
python3 os/tests/check_native_sources.py /path/to/compatible/build/compile_commands.json
```

- Six updater fault-injection tests passed, using temporary appliance paths
  and stub services: success/rollback, failed backup, incomplete package,
  install failure/restoration, and archive-link rejection.
- Actual Qt storage/eject helpers compile and pass loopback fixture tests.
- Actual page-chain guard and ANLZ routing/error handling compile and pass.
  The latter substitutes the lower track-mutating importer; it does not claim
  a full cue-engine integration test.
- All eight checked C++ translation units pass syntax checking against Linux
  Qt 6.4.2 dependencies, with current-checkout headers and regenerated moc:
  EDMC, Rekordbox, system settings, Track, overview, skin parser, and both
  QPainter/OpenGL waveform-mark renderers.
  This is not a complete linked application build or ARM64 validation.

## Still required before appliance release

1. Build the full ARM64 application and run native cue/library tests.
2. On the Pi, test two USBs (including matching labels), SD fallback on/off,
   restart with the selected USB missing, and same-path replacement media.
3. Unplug during provider resolution, streaming, finalization and index writes;
   confirm no files appear in the uncovered mountpoint on SD. Reinsert/retry.
4. Eject a downloading drive and a playing drive; confirm cancellation, saved
   state, busy/error reporting and successful remount. No force unmount.
5. Exercise near-full SD/USB and read-only media while another deck plays.
6. Install a newly built package and test restart, successful rollback and
   recovery from injected failures on a disposable image, not the live unit.
7. Verify real exports through the UI: playlists, load/preview, cue/loop banks,
   beatgrids, Unicode paths and disconnect/reconnect while two decks play.

The initial drive E audit was read-only. A subsequent authorized repair on
2026-09-04 followed a SHA-256-verified backup of all 3,345 readable files.
CHKDSK recovered 17,792 KiB into three files; a follow-up scan was clean and
all original hashes were unchanged. No Rekordbox database rewrite, firmware
update or application deployment was performed. Evidence is outside Git in
`../artifacts/usb-E-before-repair-20260904/`.
