#!/bin/sh
# Run only after the resource audit, successful native build and restart approval.
set -eu
backup=${1:?verified staging backup directory required}
case "$backup" in /home/pompu_5/bitedj-before-rekordbox-*) ;; *) exit 2 ;; esac
test "$(realpath "$backup")" = "$backup"
test -s "$backup/mixxx"
tar -tzf "$backup/resources.tgz" >/dev/null
binary=/home/pompu_5/bitedj-build/mixxx
source=/home/pompu_5/bitedj-build-src/res
test -x "$binary"
if ldd "$binary" | grep 'not found'; then exit 3; fi
supervisor=$(cat /run/user/1000/pflx-bitedj.pid)
case "$supervisor" in ''|*[!0-9]*) exit 4 ;; esac
grep -aq pflx-bitedj-supervisor "/proc/$supervisor/cmdline"
app=$(pgrep -P "$supervisor" -x mixxx)
test -n "$app"
changed=0
recover() {
    status=$?
    trap - EXIT
    if [ "$status" -ne 0 ] && [ "$changed" -eq 1 ]; then
        echo 'Install failed; restoring verified application/resources/profile backup.' >&2
        sudo install -m 0755 "$backup/mixxx" /usr/local/bin/mixxx.workflow-restore
        sudo mv /usr/local/bin/mixxx.workflow-restore /usr/local/bin/mixxx
        sudo tar -xzf "$backup/resources.tgz" -C /usr/local/share
        tar -xzf "$backup/profile-workflow.tgz" -C /home/pompu_5
    fi
    kill -CONT "$supervisor" || true
    exit "$status"
}
trap recover EXIT
kill -STOP "$supervisor"
kill -TERM "$app"
count=0
while kill -0 "$app" 2>/dev/null; do
    state=$(ps -o stat= -p "$app" || true)
    case "$state" in Z*) break ;; esac
    count=$((count + 1))
    if [ "$count" -ge 20 ]; then echo 'Application did not stop; install cancelled.' >&2; exit 5; fi
    sleep 1
done
tar -czf "$backup/profile-workflow.tgz" -C /home/pompu_5 .mixxx/mixxx.cfg .mixxx/controllers
tar -tzf "$backup/profile-workflow.tgz" >/dev/null
changed=1
sudo install -m 0755 "$binary" /usr/local/bin/mixxx.workflow-next
cmp "$binary" /usr/local/bin/mixxx.workflow-next
for relative in controllers/piflex-padfx.js controllers/Pioneer-DDJ-FLX6-script.js controllers/Pioneer-DDJ-FLX6.midi.xml skins/BiteDJ/deck.xml skins/BiteDJ/library.xml skins/BiteDJ/settings.xml skins/BiteDJ/padfx-settings.xml skins/BiteDJ/skin.xml skins/BiteDJ/waveform.xml skins/BiteDJ/templates/grid_deck_row.xml; do
    sudo install -m 0644 "$source/$relative" "/usr/local/share/mixxx/$relative"
    cmp "$source/$relative" "/usr/local/share/mixxx/$relative"
done
for name in piflex-padfx.js Pioneer-DDJ-FLX6-script.js Pioneer-DDJ-FLX6.midi.xml; do
    cp "$source/controllers/$name" "/home/pompu_5/.mixxx/controllers/$name"
    cmp "$source/controllers/$name" "/home/pompu_5/.mixxx/controllers/$name"
done
sudo mv /usr/local/bin/mixxx.workflow-next /usr/local/bin/mixxx
cmp "$binary" /usr/local/bin/mixxx
sha256sum /usr/local/bin/mixxx
echo 'Verified install; resuming existing BiteDJ supervisor.'
