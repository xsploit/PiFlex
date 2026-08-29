# DDJ-PFLX6 development roadmap

This branch turns BiteDJ into the software side of the Raspberry Pi 5 +
10-inch Touch Display 2 + DDJ-FLX6 standalone build.

## 1. Restore a dependable baseline

- [ ] Build the exact BiteDJ source revision for ARM64 Debian 13.
- [x] Restore the last working Mixxx profile, audio routing, launcher, and
  autostart configuration.
- [x] Include the final local FLX6 mapping, including browser navigation and
  the VIEW-to-library binding.
- [ ] Package the executable, resources, mapping, profile, and launcher as one
  restorable archive after every known-good build.
- [ ] Verify controller input, master/headphone audio, USB library browsing,
  and the touchscreen on the physical Pi.

## 2. Pull in fixes and features that matter to this build

- [ ] Fix USB-backed history writes blocking the UI, with queued writes kept
  off the Qt main thread and safely drained or cancelled before drive eject.
- [ ] Verify the merged hidden `.PIONEER/rekordbox/export.pdb` drive-detection
  fix is present and working on the physical Pi.
- [x] Initialize a newly enabled Echo, Flanger, or similar effect to an audible
  metaknob depth instead of silently leaving it at zero.
- [ ] Verify Echo and Flanger from the FLX6's normal Beat FX LEVEL/DEPTH control
  on the physical controller.
- [x] Integrate the open Pioneer-style Memory Cue PR.
- [ ] Verify Memory Cue behavior and extend its controller mapping to the FLX6
  only where it fits our workflow.
- [ ] Add a usable beatgrid correction view instead of forcing the user to
  accept every automatic analysis result.
- [ ] Review upstream BiteDJ PRs and bug reports before each release and pull
  only changes that improve this controller, USB, touchscreen, or Pi target.

## 3. EDMC acquisition workflow

- [ ] Add an authenticated EDMC browser/import view that uses the user's own
  account session and only accesses music available to that account.
- [ ] Index only user-selected EDMC genres or subsections, such as Jump-Up,
  Jungle/Ragga, Neurofunk/Dark, Deep Dubstep, or Riddim, rather than crawling
  the entire music section. Remember topic IDs and only inspect new or changed
  entries on later refreshes.
- [ ] Resolve supported download-provider pages through explicit provider
  adapters, starting with the provider used by the EDMC posts we tested.
- [ ] Preview a track before downloading when the source exposes a preview.
- [ ] Download into a watched inbox with progress, cancellation, duplicate
  detection, and clear failure recovery.
- [ ] Analyze a completed download in the background and expose it in the
  library without restarting BiteDJ.
- [ ] Keep all web, download, and analysis work away from the real-time audio
  thread.

## 4. Finish the FLX6 hardware workflow

- [ ] Verify all eight performance pads in Hot Cue, Pad FX, Beat Jump, Beat
  Loop, and Sampler modes.
- [ ] Replace BiteDJ's generic Pad FX bank with this fixed FLX6 bank on every
  deck: Pad 1 Roll 1/2, Pad 2 Roll 1/4, Pad 3 Roll 1/8, Pad 4 Trans 1/4,
  Pad 5 LFO HPF 8 beats, Pad 6 Echo Out 1/2, Pad 7 Vinyl Break 1 beat, and
  Pad 8 Backspin 1 beat. Pads 6-8 must use release-FX behavior and restore
  transport/effect state cleanly.
- [ ] Verify FILTER, CUE, PLAY, SYNC, tempo, jog, EQ, trim, channel faders, and
  crossfader behavior on both primary decks.
- [ ] Make encoder rotation, encoder press, VIEW, BACK, and deck LOAD buttons
  navigate the library without needing to touch the display.
- [ ] Keep four-deck controls available without making the two-deck screen
  harder to use.
- [ ] Replace the desktop-style sound preferences page with a compact,
  touch-friendly routing screen.

## 5. Preserve Rekordbox USB preparation

- [ ] Prefer the USB's Rekordbox beatgrid, first downbeat, cues, BPM, and key
  when those values exist.
- [ ] Make it obvious whether a displayed value came from Rekordbox or BiteDJ
  analysis.
- [ ] Avoid re-analysis when valid prepared data or a `.bitedj` cache already
  exists.
- [ ] Keep analysis, cue overrides, ratings, history, and sampler data on the
  removable drive.

## 6. Performance and appliance behavior

- [ ] Launch BiteDJ full-screen at login with the display in landscape.
- [ ] Add real-time scheduling and isolate heavy analysis from the audio path.
- [ ] Disable only services that are unnecessary in DJ mode.
- [ ] Measure audio xruns, waveform frame time, CPU temperature, and analysis
  time before and after each optimization.
- [ ] Provide a normal desktop mode so the Pi can still be used as a tablet or
  general computer.

## 7. Touch UI and skins

- [ ] Make settings and long menus vertically scrollable with reachable Apply
  and Save controls.
- [ ] Keep stacked waveforms responsive on phone, 7-inch, and 10-inch layouts.
- [ ] Add an XDJ-style skin option without losing the BiteDJ USB workflow.
- [ ] Preserve user layout adjustments and prevent accidental dragging outside
  explicit edit mode.

## 8. Stems

- [ ] Add a Fadr-backed stem job queue with progress, caching, cancellation,
  and clear failure recovery.
- [ ] Keep stem processing off the real-time audio thread.
