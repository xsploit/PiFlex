#!/bin/sh
# Existing PiFlex RT device installer. Run after the native screen installer.
set -eu
stage=${1:?usage: sudo sh install-early.sh /absolute/staging/directory}
test "$(id -u)" -eq 0
test -x /usr/sbin/mkinitramfs
test -x /usr/local/bin/pflx-boot-screen
test "$(uname -r)" = '6.18.48-pflx-rt+'
grep -Fxq 'kernel=kernel_piflex_rt.img' /boot/firmware/config.txt
for name in piflex.plymouth piflex.script logo.png blue.png track.png; do
    test -s "$stage/theme/$name"
done
backup=$(mktemp -d /var/backups/piflex-early-boot.XXXXXXXX)
paths='boot/firmware/config.txt
etc/plymouth/plymouthd.conf
etc/initramfs-tools/modules
etc/systemd/system/pflx-session.service.d/boot-screen.conf
etc/systemd/system/plymouth-quit.service.d/piflex.conf'
printf '%s\n' "$paths" > "$backup/paths"
printf '%s\n' "$paths" | while IFS= read -r relative; do
    if [ -e "/$relative" ]; then
        mkdir -p "$backup/files/$(dirname "$relative")"
        cp -a "/$relative" "$backup/files/$relative"
        cmp "/$relative" "$backup/files/$relative"
    fi
done
cat > "$backup/restore.sh" <<'SH'
#!/bin/sh
set -eu
test "$(id -u)" -eq 0
backup=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
while IFS= read -r relative; do
    if [ -e "$backup/files/$relative" ]; then
        cp -a "$backup/files/$relative" "/$relative"
    else
        rm -f -- "/$relative"
    fi
done < "$backup/paths"
systemctl daemon-reload
sync
echo 'Original boot selection restored. No reboot performed.'
SH
chmod 0700 "$backup/restore.sh"
restore_on_error() {
    status=$?
    trap - EXIT
    if [ "$status" -ne 0 ]; then sh "$backup/restore.sh"; fi
    exit "$status"
}
trap restore_on_error EXIT
install -d /usr/share/plymouth/themes/piflex /etc/plymouth \
    /etc/systemd/system/pflx-session.service.d /etc/systemd/system/plymouth-quit.service.d
for name in piflex.plymouth piflex.script logo.png blue.png track.png; do
    install -m 0644 "$stage/theme/$name" "/usr/share/plymouth/themes/piflex/$name"
done
printf '[Daemon]\nTheme=piflex\nShowDelay=0\nDeviceTimeout=8\n' > /etc/plymouth/plymouthd.conf
printf '[Unit]\nWants=plymouth-quit.service\nAfter=plymouth-quit.service\n' \
    > /etc/systemd/system/pflx-session.service.d/boot-screen.conf
printf '[Service]\nExecStart=\nExecStart=-/usr/bin/plymouth quit --retain-splash\n' \
    > /etc/systemd/system/plymouth-quit.service.d/piflex.conf
touch /etc/initramfs-tools/modules
for module in vc4 drm_rp1_dsi panel_ilitek_ili79600a rpi_panel_v2_regulator; do
    grep -Fxq "$module" /etc/initramfs-tools/modules || printf '%s\n' "$module" >> /etc/initramfs-tools/modules
done
grep -Fxq 'CONFIG_RD_XZ=y' "/boot/config-$(uname -r)"
/usr/sbin/mkinitramfs -c xz -l 3 -o "$backup/initramfs.new" "$(uname -r)"
lsinitramfs "$backup/initramfs.new" > "$backup/initramfs.files"
for required in usr/sbin/plymouthd usr/share/plymouth/themes/piflex/piflex.script \
    usr/share/plymouth/themes/piflex/logo.png; do
    grep -Fxq "$required" "$backup/initramfs.files"
done
grep -q 'drm-rp1-dsi.ko' "$backup/initramfs.files"
grep -q 'panel-ilitek-ili79600a.ko' "$backup/initramfs.files"
python3 - "$backup" <<'PY'
from pathlib import Path
import os, re, sys
backup = Path(sys.argv[1])
boot = Path('/boot/firmware')
config = (boot / 'config.txt').read_text()
init = re.findall(r'^initramfs (\S+) followkernel$', config, re.M)
cmd = re.findall(r'^cmdline=(\S+)$', config, re.M)
if len(init) != 1 or len(cmd) != 1 or any('/' in p for p in init + cmd):
    raise SystemExit('Boot selection is ambiguous; previous configuration retained')
if init[0] not in ('initramfs_piflex_rt', 'initramfs_piflex_splash'):
    raise SystemExit('Unexpected initramfs selection')
tokens = (boot / cmd[0]).read_text().split()
tokens = [t for t in tokens if t not in ('console=tty1', 'console=tty3') and t.split('=')[0]
          not in ('quiet', 'splash', 'loglevel', 'logo.nologo', 'vt.global_cursor_default',
                  'systemd.show_status', 'rd.systemd.show_status', 'plymouth.ignore-serial-consoles')]
tokens += ['console=tty3', 'quiet', 'splash', 'loglevel=3', 'logo.nologo',
           'vt.global_cursor_default=0', 'systemd.show_status=false',
           'rd.systemd.show_status=false', 'plymouth.ignore-serial-consoles']
new_config = config.replace('initramfs '+init[0]+' followkernel', 'initramfs initramfs_piflex_splash followkernel')
new_config = new_config.replace('cmdline='+cmd[0], 'cmdline=cmdline_piflex_splash.txt')
new_config += '\n[all]\n# PiFlex graphical boot: hide the firmware rainbow.\ndisable_splash=1\n'
size = (backup/'initramfs.new').stat().st_size
v = os.statvfs(boot)
if size + 2 * 1024 * 1024 > v.f_bavail * v.f_frsize:
    raise SystemExit('Insufficient boot space for a separate verified initramfs')
(backup/'cmdline.new').write_text(' '.join(tokens)+'\n')
(backup/'config.new').write_text(new_config)
PY
cp "$backup/initramfs.new" /boot/firmware/initramfs_piflex_splash
cmp "$backup/initramfs.new" /boot/firmware/initramfs_piflex_splash
cp "$backup/cmdline.new" /boot/firmware/cmdline_piflex_splash.txt
sync
# Switch boot selection only after the new image is complete and verified.
cp "$backup/config.new" /boot/firmware/config.txt
cmp "$backup/config.new" /boot/firmware/config.txt
systemctl daemon-reload
systemd-analyze verify pflx-session.service plymouth-quit.service
sync
echo "Early boot splash installed. Restore: sudo sh $backup/restore.sh"
sha256sum /boot/firmware/initramfs_piflex_splash
