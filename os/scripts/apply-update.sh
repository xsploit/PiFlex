#!/bin/bash
# Bootstrap v2 on images whose old updater cannot install runtime scripts.
# Run from SSH: sudo bash apply-update.sh /path/to/pflx-update.tar.gz
set -Eeuo pipefail
bundle=${1:?bundle required}
[[ $(id -u) == 0 && -f "$bundle" && -f "$bundle.sha256" ]]
expected=$(awk 'NR == 1 { print $1 }' "$bundle.sha256")
actual=$(sha256sum "$bundle" | awk '{ print $1 }')
[[ "$expected" == "$actual" ]] || { echo 'Bundle checksum mismatch' >&2; exit 1; }
stage=$(mktemp -d /var/tmp/pflx-bootstrap.XXXXXX)
trap 'rm -rf -- "$stage"' EXIT
# Extract to stdout, never to an archive-controlled path. The new updater
# validates the entire archive before modifying anything on the appliance.
tar -xOzf "$bundle" payload/usr/local/sbin/pflx-update >"$stage/pflx-update"
[[ -s "$stage/pflx-update" ]]
bash -n "$stage/pflx-update"
bash "$stage/pflx-update" "$bundle"
