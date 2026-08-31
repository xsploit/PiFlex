#!/bin/sh
set -eu

project_source=${1:?usage: build-wsl.sh /mnt/c/path/to/pflx-os}
builder=${PFLX_IMAGE_GEN:-/root/pflx-build/rpi-image-gen}
source_copy=${PFLX_SOURCE_COPY:-/root/pflx-build/pflx-os-source}
build_root=${PFLX_BUILD_ROOT:-/root/pflx-build/pflx-image-work}

test -x "$builder/rpi-image-gen"
test -f "$project_source/config/piflex-os.yaml"
test -f "$project_source/assets/bitedj-rootfs.tar.gz"

mkdir -p "$source_copy" "$build_root"
rsync -a --delete --exclude dist/ "$project_source/" "$source_copy/"
chmod 0755 "$source_copy/scripts/"*.sh "$source_copy/kernel/"*.sh

cd "$builder"
export ARCH=arm64
exec ./rpi-image-gen build -S "$source_copy" -B "$build_root" -c piflex-os.yaml
