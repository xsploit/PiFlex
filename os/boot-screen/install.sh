#!/bin/sh
set -eu
stage=${1:?usage: sudo sh install.sh /absolute/staging/directory}
test "$(id -u)" -eq 0
test -f /etc/sway/pflx.conf
for name in pflx-boot-screen piflex-logo.svg Ubuntu-R.ttf Ubuntu.LICENCE.txt start-pflx-kiosk; do
    test -s "$stage/$name"
done
ldd "$stage/pflx-boot-screen" > "$stage/boot-screen-ldd.txt"
if grep -q 'not found' "$stage/boot-screen-ldd.txt"; then
    cat "$stage/boot-screen-ldd.txt" >&2
    exit 1
fi
python3 - "$stage/pflx.conf.next" <<'PY'
from pathlib import Path
import sys
config = Path('/etc/sway/pflx.conf').read_text()
old = 'exec_always --no-startup-id /usr/local/bin/pflx-bitedj-supervisor'
new = 'exec --no-startup-id /usr/local/bin/start-pflx-kiosk'
if config.count(old) == 1:
    config = config.replace(old, new)
elif config.count(new) != 1:
    raise SystemExit('Unrecognized Sway startup command; no changes installed')
Path(sys.argv[1]).write_text(config)
PY
install -d /var/backups/pflx-boot-screen
backup=$(mktemp -d /var/backups/pflx-boot-screen/install.XXXXXXXX)
paths='etc/sway/pflx.conf
usr/local/bin/pflx-boot-screen
usr/local/bin/start-pflx-kiosk
usr/local/share/piflex/boot/piflex-logo.svg
usr/local/share/piflex/boot/Ubuntu-R.ttf
usr/local/share/piflex/boot/Ubuntu.LICENCE.txt'
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
echo 'Restored startup files. Running session unchanged.'
SH
chmod 0700 "$backup/restore.sh"
restore_on_error() {
    status=$?
    trap - EXIT
    if [ "$status" -ne 0 ]; then sh "$backup/restore.sh"; fi
    exit "$status"
}
trap restore_on_error EXIT
install -d /usr/local/share/piflex/boot
install -m 0755 "$stage/pflx-boot-screen" /usr/local/bin/pflx-boot-screen.next
mv /usr/local/bin/pflx-boot-screen.next /usr/local/bin/pflx-boot-screen
install -m 0755 "$stage/start-pflx-kiosk" /usr/local/bin/start-pflx-kiosk
for name in piflex-logo.svg Ubuntu-R.ttf Ubuntu.LICENCE.txt; do
    install -m 0644 "$stage/$name" "/usr/local/share/piflex/boot/$name"
done
install -m 0644 "$stage/pflx.conf.next" /etc/sway/pflx.conf
cmp "$stage/pflx-boot-screen" /usr/local/bin/pflx-boot-screen
cmp "$stage/pflx.conf.next" /etc/sway/pflx.conf
echo "Installed for next session. Restore: sudo sh $backup/restore.sh"
