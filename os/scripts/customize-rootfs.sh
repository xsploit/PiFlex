#!/bin/sh
set -eu

rootfs=${1:?root filesystem path required}
target_user=${2:?target user required}
source_root=${3:?PFLX source root required}
overlay="$source_root/layer/rootfs-overlay"
assets="$source_root/assets"

test -f "$assets/bitedj-rootfs.tar.gz"
test -f "$assets/edmc-companion/package-lock.json"
test -f "$assets/controllers/Pioneer-DDJ-FLX6-script.js"
test -f "$assets/controllers/Pioneer-DDJ-FLX6.midi.xml"

cp -a "$overlay/." "$rootfs/"
tar -xzf "$assets/bitedj-rootfs.tar.gz" -C "$rootfs"

# The public layer uses a placeholder so builders can choose their own account
# name without editing every systemd unit and mount helper.
find "$rootfs/etc" "$rootfs/usr/local" -type f | while IFS= read -r target; do
    if grep -q '@PIFLEX_USER@' "$target"; then
        sed -i "s/@PIFLEX_USER@/$target_user/g" "$target"
    fi
done

# Files copied from a Windows-mounted workspace may all appear as mode 0777.
# Normalize configuration data before systemd or policykit inspect it.
find "$overlay/etc" -type f | while IFS= read -r source; do
    relative=${source#"$overlay/"}
    chmod 0644 "$rootfs/$relative"
done
find "$rootfs/usr/local/bin" "$rootfs/usr/local/sbin" -type f -exec chmod 0755 {} +

install -d "$rootfs/opt/pflx/edmc-companion"
cp -a "$assets/edmc-companion/." "$rootfs/opt/pflx/edmc-companion/"
find "$rootfs/opt/pflx/edmc-companion" -path '*/node_modules' -prune -o -type d -exec chmod 0755 {} +
find "$rootfs/opt/pflx/edmc-companion" -path '*/node_modules' -prune -o -type f -exec chmod 0644 {} +

install -d "$rootfs/usr/local/share/mixxx/controllers"
install -m 0644 "$assets/controllers/Pioneer-DDJ-FLX6-script.js" \
    "$rootfs/usr/local/share/mixxx/controllers/Pioneer-DDJ-FLX6-script.js"
install -m 0644 "$assets/controllers/Pioneer-DDJ-FLX6.midi.xml" \
    "$rootfs/usr/local/share/mixxx/controllers/Pioneer-DDJ-FLX6.midi.xml"

chroot "$rootfs" sh -c 'cd /opt/pflx/edmc-companion && npm ci --omit=dev --ignore-scripts'

for group in audio video input render plugdev; do
    if ! chroot "$rootfs" getent group "$group" >/dev/null; then
        chroot "$rootfs" groupadd --system "$group"
    fi
done
chroot "$rootfs" usermod -a -G audio,video,input,render,plugdev "$target_user"
chroot "$rootfs" chown -R "$target_user:$target_user" "/home/$target_user"
chroot "$rootfs" chown -R root:root /opt/pflx/edmc-companion

install -d "$rootfs/etc/polkit-1/rules.d"
cat > "$rootfs/etc/polkit-1/rules.d/49-pflx-udisks.rules" <<EOF
polkit.addRule(function(action, subject) {
    if (subject.user == "$target_user" && action.id.indexOf("org.freedesktop.udisks2.") == 0) {
        return polkit.Result.YES;
    }
});
EOF

for unit in pflx-grow-root.service pflx-tune.service pflx-session.service pflx-edmc.service avahi-daemon.service; do
    systemctl --root="$rootfs" enable "$unit"
done
systemctl --root="$rootfs" set-default graphical.target

for unit in apt-daily.timer apt-daily-upgrade.timer dpkg-db-backup.timer \
        e2scrub_all.timer fstrim.timer man-db.timer; do
    systemctl --root="$rootfs" disable "$unit" 2>/dev/null || true
done

# Keep Bluetooth available for optional peripherals, but leave its daemon and
# UART helper stopped by default so the DJ appliance pays no runtime cost.
for unit in bluetooth.service hciuart.service; do
    systemctl --root="$rootfs" disable "$unit" 2>/dev/null || true
done

install -d "$rootfs/etc/systemd/system/irqbalance.service.d"
systemctl --root="$rootfs" mask irqbalance.service 2>/dev/null || true
systemctl --root="$rootfs" mask dphys-swapfile.service 2>/dev/null || true

config="$rootfs/boot/firmware/config.txt"
cat >> "$config" <<'EOF'

# PiFlex OS: official 10.1-inch Touch Display 2 in landscape.
display_auto_detect=0
dtoverlay=vc4-kms-dsi-ili79600-10-1inch,rotation=90
disable_fw_kms_setup=1
max_framebuffers=2
EOF

cmdline="$rootfs/boot/firmware/cmdline.txt"
python3 - "$cmdline" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
tokens = path.read_text(encoding="utf-8").strip().split()
extra = [
    "threadirqs",
    "isolcpus=2,3",
    "nohz_full=3",
    "rcu_nocbs=2,3",
    "irqaffinity=0,1",
    "kthread_cpus=0-1",
    "skew_tick=1",
    "usbcore.autosuspend=-1",
]
for token in extra:
    key = token.split("=", 1)[0]
    tokens = [existing for existing in tokens if existing.split("=", 1)[0] != key]
    tokens.append(token)
path.write_text(" ".join(tokens) + "\n", encoding="utf-8")
PY

cat > "$rootfs/etc/os-release" <<'EOF'
NAME="PiFlex OS"
ID=piflex-os
ID_LIKE=debian
VERSION="0.1-dev"
VERSION_ID="0.1"
PRETTY_NAME="PiFlex OS 0.1 development image"
EOF

printf '%s\n' 'piflex-os-dev' > "$rootfs/etc/debian_chroot"
printf '%s\n' 'PiFlex OS build completed.'
