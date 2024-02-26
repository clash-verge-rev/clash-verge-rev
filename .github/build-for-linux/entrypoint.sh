#!/bin/bash

wget https://nodejs.org/dist/v20.10.0/node-v20.10.0-linux-x64.tar.xz
tar -Jxvf ./node-v20.10.0-linux-x64.tar.xz
export PATH=$(pwd)/node-v20.10.0-linux-x64/bin:$PATH
npm install pnpm -g

rustup target add "$INPUT_TARGET"

if [ "$INPUT_TARGET" = "x86_64-unknown-linux-gnu" ]; then
    apt-get update
    apt-get install -y libgtk-3-dev libwebkit2gtk-4.0-dev libayatana-appindicator3-dev librsvg2-dev patchelf
elif [ "$INPUT_TARGET" = "aarch64-unknown-linux-gnu" ]; then
    dpkg --add-architecture arm64
    apt-get update
    apt-get install -y libncurses6:arm64 libtinfo6:arm64 linux-libc-dev:arm64 libncursesw6:arm64 libssl3:arm64 libcups2:arm64
    apt-get install -y --no-install-recommends g++-aarch64-linux-gnu libc6-dev-arm64-cross libssl-dev:arm64 libwebkit2gtk-4.0-dev:arm64 libgtk-3-dev:arm64 patchelf:arm64 librsvg2-dev:arm64 libayatana-appindicator3-dev:arm64
    export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc
    export CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc
    export CXX_aarch64_unknown_linux_gnu=aarch64-linux-gnu-g++
    export PKG_CONFIG_PATH=/usr/lib/aarch64-linux-gnu/pkgconfig
    export PKG_CONFIG_ALLOW_CROSS=1
elif [ "$INPUT_TARGET" = "armv7-unknown-linux-gnueabihf" ]; then
    dpkg --add-architecture armhf
    apt-get update
    apt-get install -y libncurses6:armhf libtinfo6:armhf linux-libc-dev:armhf libncursesw6:armhf libssl3:armhf libcups2:armhf
    apt-get install -y --no-install-recommends g++-arm-linux-gnueabihf libc6-dev-armhf-cross libssl-dev:armhf libwebkit2gtk-4.0-dev:armhf libgtk-3-dev:armhf patchelf:armhf librsvg2-dev:armhf libayatana-appindicator3-dev:armhf
    export CARGO_TARGET_ARMV7_UNKNOWN_LINUX_GNUEABIHF_LINKER=arm-linux-gnueabihf-gcc
    export CC_armv7_unknown_linux_gnueabihf=arm-linux-gnueabihf-gcc
    export CXX_armv7_unknown_linux_gnueabihf=arm-linux-gnueabihf-g++
    export PKG_CONFIG_PATH=/usr/lib/arm-linux-gnueabihf/pkgconfig
    export PKG_CONFIG_ALLOW_CROSS=1
else
    echo "Unknown target: $INPUT_TARGET" && exit 1
fi

bash .github/build-for-linux/build.sh