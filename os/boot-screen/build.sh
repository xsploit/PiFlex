#!/bin/sh
set -eu
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output=${1:?usage: build.sh /path/to/pflx-boot-screen}
c++ -std=c++17 -O2 -Wall -Wextra -Werror -fPIC "$source_dir/main.cpp" \
    $(pkg-config --cflags --libs Qt6Widgets Qt6Svg) -o "$output"
