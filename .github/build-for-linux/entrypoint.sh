#!/bin/bash

wget https://nodejs.org/dist/v20.10.0/node-v20.10.0-linux-x64.tar.xz
tar -Jxvf ./node-v20.10.0-linux-x64.tar.xz
export PATH=$(pwd)/node-v20.10.0-linux-x64/bin:$PATH
npm install pnpm -g

rustup target add "$INPUT_TARGET"
echo "rustc version: $(rustc --version)"

if [ "$INPUT_TARGET" = "x86_64-unknown-linux-gnu" ]; then
    apt-get update
    apt-get install -y libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libglib2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
    export PKG_CONFIG_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig
fi

bash .github/build-for-linux/build.sh
