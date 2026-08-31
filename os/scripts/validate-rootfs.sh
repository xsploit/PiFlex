#!/bin/sh
set -eu

rootfs=${1:?usage: validate-rootfs.sh /path/to/rootfs}
fail=0

check_file() {
    if [ ! -e "$rootfs/$1" ]; then
        echo "MISSING $1" >&2
        fail=1
    else
        echo "OK $1"
    fi
}

for path in \
    usr/local/bin/mixxx \
    usr/local/bin/pflx-bitedj-supervisor \
    usr/local/bin/start-pflx-edmc \
    usr/local/sbin/pflx-tune \
    usr/local/sbin/pflx-update \
    usr/local/sbin/pflx-rollback \
    usr/local/share/mixxx/controllers/Pioneer-DDJ-FLX6-script.js \
    usr/local/share/mixxx/controllers/Pioneer-DDJ-FLX6.midi.xml \
    opt/pflx/edmc-companion/src/main.mjs \
    etc/sway/pflx.conf \
    etc/systemd/system/pflx-session.service \
    etc/systemd/system/pflx-edmc.service \
    etc/ssh/sshd_config \
    boot/firmware/config.txt \
    boot/firmware/cmdline.txt; do
    check_file "$path"
done

file "$rootfs/usr/local/bin/mixxx" | tee /tmp/pflx-mixxx-file.txt
grep -Eq 'ARM aarch64|ARM64' /tmp/pflx-mixxx-file.txt || { echo 'BiteDJ is not ARM64' >&2; fail=1; }
grep -q 'vc4-kms-dsi-ili79600-10-1inch' "$rootfs/boot/firmware/config.txt" || fail=1
grep -q 'isolcpus=2,3' "$rootfs/boot/firmware/cmdline.txt" || fail=1
grep -q 'ENGINE_CPU=3' "$rootfs/etc/systemd/system/pflx-session.service" || fail=1
grep -q 'CONTROLLER_CPU=2' "$rootfs/etc/systemd/system/pflx-session.service" || fail=1
grep -q 'ozone-platform=wayland' "$rootfs/opt/pflx/edmc-companion/src/browser-session.mjs" || fail=1

if command -v systemd-analyze >/dev/null 2>&1; then
    systemd-analyze verify --root="$rootfs" \
        pflx-grow-root.service pflx-tune.service pflx-session.service pflx-edmc.service
fi

exit "$fail"
