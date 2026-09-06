#!/bin/sh
# Run over SSH on an idle deck. Exercises DRM Plymouth -> Sway -> native splash.
set -eu
stage=${1:?usage: sudo sh test-display.sh /absolute/results/directory}
test "$(id -u)" -eq 0
test -d "$stage"
restore() {
    status=$?
    trap - EXIT
    /usr/bin/plymouth quit 2>/dev/null || true
    systemctl start pflx-session.service
    exit "$status"
}
trap restore EXIT
systemctl stop pflx-session.service
/usr/sbin/plymouthd --mode=boot --tty=/dev/tty1 --ignore-serial-consoles \
    --kernel-command-line='quiet splash plymouth.ignore-serial-consoles' \
    --debug --debug-file="$stage/plymouth-display.log"
/usr/bin/plymouth show-splash
/usr/bin/plymouth display-message --text='BOOT SCREEN TEST'
sleep 3
/usr/bin/plymouth --ping
/usr/bin/plymouth --has-active-vt
timeout 8 ffmpeg -v warning -device /dev/dri/card0 -f kmsgrab -i - \
    -vf hwdownload,format=bgr0 -frames:v 1 -y "$stage/plymouth-display.png" \
    > "$stage/capture.log" 2>&1 || true
sleep 2
if grep -Ei 'parse error|syntax error|script error' "$stage/plymouth-display.log"; then
    exit 1
fi
echo 'Plymouth running on active VT; no script parser errors in debug log.'
