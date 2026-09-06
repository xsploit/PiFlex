# PiFlex startup screen

Plymouth early OS splash plus a native Qt 6/Wayland handover for Sway. The original SVG
wordmark uses extended, angular, slanted lettering. Ubuntu is used for labels;
its existing licence is included with the installed font.

Plymouth starts from the initramfs once the display driver is available. Quiet
boot flags hide normal console output on the touchscreen, the firmware rainbow
is disabled, and console recovery remains on tty3 with serial diagnostics.
The screen can be black briefly before Linux initializes the display; it is
not an EEPROM/firmware replacement. Plymouth uses OS boot progress and status
callbacks, retaining its last frame while handing the display to Sway.

The native continuation's blue bar advances at observed milestones: display process, existing
supervisor, Mixxx child process, then the mapped `org.mixxx.Mixxx` window. A
moving highlight shows activity between milestones. There is no invented
completion percentage. A mapped window is UI readiness, not a claim about
audio-device readiness. The process exits on handover, recovery terminal, or
after 60 seconds. It never controls the audio process.

## Build on the Pi

Requires a C++ compiler, pkg-config, Qt6Widgets and Qt6Svg development files:

```sh
sh os/boot-screen/build.sh /tmp/pflx-boot-screen
```

For image builds, copy this ARM64 binary to
`artifacts/boot-screen/pflx-boot-screen` before `prepare-assets.ps1`, or supply
`-BootScreenBinary`. The image overlay installs the wrapper and the asset
preparation step includes the SVG/font. The ordinary v2 application updater
does not install or remove this separate OS startup feature.

For an existing Pi, stage the binary, `piflex-logo.svg`, `Ubuntu-R.ttf`,
`Ubuntu.LICENCE.txt`, and `start-pflx-kiosk` together and run
`sudo sh install.sh /absolute/staging/directory`. The installer saves the old
files and a restore script before changing them; it does not reboot or restart
the running session.

On the development RT Pi, install Plymouth packages, stage the theme directory,
then run `sudo sh install-early.sh /absolute/staging/directory`. This installer
is intentionally restricted to the inspected `6.18.48-pflx-rt+` kernel and its
explicit boot selection. It makes a separate XZ-compressed initramfs with the
theme and display modules, validates its contents, checks space, and changes
the boot selection last. The existing kernel, RT initramfs and command line
remain available. Other kernel layouts need their boot selection inspected
before adapting the installer. Image builds use the rootfs theme/config overlay.

Theme PNGs are generated from the same SVG using the native binary:

```sh
QT_QPA_PLATFORM=offscreen pflx-boot-screen --export-plymouth /path/to/theme
```

## Preview and verify

From the existing Sway session:

```sh
/usr/local/bin/pflx-boot-screen --preview
```

Preview labels itself as such and closes after 12 seconds. For a PNG without
touching the current display:

```sh
QT_QPA_PLATFORM=offscreen /usr/local/bin/pflx-boot-screen --preview --snapshot /tmp/piflex-startup.png
```

`PIFLEX_BOOT_ASSETS` can point to a staging directory for testing. Normal mode
checks Sway asynchronously and exits as soon as the existing deck window is
found. `exec` in the Sway config starts the wrapper once per session; config
reloads do not create extra splash processes.
