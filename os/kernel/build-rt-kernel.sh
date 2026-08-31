#!/bin/sh
set -eu

jobs=${JOBS:-$(nproc)}
cross=${CROSS_COMPILE:-aarch64-linux-gnu-}
work=${PFLX_KERNEL_WORK:-$HOME/pflx-build/kernel}
source_dir="$work/linux"
out="$work/out"
packages="$work/packages"
fragment=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/pflx-rt.fragment

mkdir -p "$work" "$out" "$packages"
if [ ! -d "$source_dir/.git" ]; then
    git clone --depth 1 --branch rpi-6.18.y https://github.com/raspberrypi/linux.git "$source_dir"
fi
git -C "$source_dir" fetch --depth 1 origin rpi-6.18.y
git -C "$source_dir" checkout --detach FETCH_HEAD

make -C "$source_dir" O="$out" ARCH=arm64 CROSS_COMPILE="$cross" bcm2712_defconfig
"$source_dir/scripts/kconfig/merge_config.sh" -m -O "$out" "$out/.config" "$fragment"
make -C "$source_dir" O="$out" ARCH=arm64 CROSS_COMPILE="$cross" olddefconfig

for option in CONFIG_PREEMPT_RT=y CONFIG_HZ_1000=y CONFIG_NO_HZ_FULL=y CONFIG_SND_USB_AUDIO=m; do
    grep -qx "$option" "$out/.config" || { echo "Missing required kernel option: $option" >&2; exit 1; }
done

if [ "${CONFIG_ONLY:-0}" = 1 ]; then
    cp "$out/.config" "$packages/pflx-rt.config"
    sha256sum "$packages/pflx-rt.config" > "$packages/SHA256SUMS"
    printf 'Validated PFLX RT kernel config: %s\n' "$packages/pflx-rt.config"
    exit 0
fi

make -C "$source_dir" O="$out" ARCH=arm64 CROSS_COMPILE="$cross" -j"$jobs" Image modules dtbs
kernel_release=$(make -s -C "$source_dir" O="$out" ARCH=arm64 CROSS_COMPILE="$cross" kernelrelease)
make -C "$source_dir" O="$out" ARCH=arm64 CROSS_COMPILE="$cross" \
    bindeb-pkg KDEB_PKGVERSION="$kernel_release-1" DPKG_FLAGS=-d
find "$work" -maxdepth 1 -name '*.deb' -exec cp -f {} "$packages/" \;
cp "$out/.config" "$packages/pflx-rt.config"
sha256sum "$packages"/*.deb "$packages/pflx-rt.config" > "$packages/SHA256SUMS"
printf 'PFLX RT kernel packages: %s\n' "$packages"
