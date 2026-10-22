#!/usr/bin/env bash
set -euo pipefail

echo "Installing Dependencies for Clash-Verge-Rev"
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  libssl-dev \
  pkg-config \
  libxslt1.1 \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf

echo "Installing Dependencies for Clash-Verge-Rev"
pnpm install
