FROM ubuntu:22.04

# change the sources list and install dependencies
RUN rm -f /etc/apt/sources.list && \
    echo "deb [arch=amd64,i386] http://archive.ubuntu.com/ubuntu jammy main multiverse universe restricted" | tee -a /etc/apt/sources.list && \
    echo "deb [arch=amd64,i386] http://archive.ubuntu.com/ubuntu jammy-security main multiverse universe restricted" | tee -a /etc/apt/sources.list && \
    echo "deb [arch=amd64,i386] http://archive.ubuntu.com/ubuntu jammy-updates main multiverse universe restricted" | tee -a /etc/apt/sources.list && \
    echo "deb [arch=amd64,i386] http://archive.ubuntu.com/ubuntu jammy-backports main multiverse universe restricted" | tee -a /etc/apt/sources.list && \
    echo "deb [arch=armhf,arm64] http://ports.ubuntu.com/ubuntu-ports jammy main multiverse universe restricted" | tee -a /etc/apt/sources.list && \
    echo "deb [arch=armhf,arm64] http://ports.ubuntu.com/ubuntu-ports jammy-security main multiverse universe restricted" | tee -a /etc/apt/sources.list && \
    echo "deb [arch=armhf,arm64] http://ports.ubuntu.com/ubuntu-ports jammy-updates main multiverse universe restricted" | tee -a /etc/apt/sources.list && \
    echo "deb [arch=armhf,arm64] http://ports.ubuntu.com/ubuntu-ports jammy-backports main multiverse universe restricted" | tee -a /etc/apt/sources.list

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    g++-aarch64-linux-gnu libc6-dev-arm64-cross \
    ca-certificates curl wget gnupg build-essential pkg-config file && \
    rm -rf /var/lib/apt/lists/*

RUN dpkg --add-architecture arm64 && \
    apt-get update && \
    apt-get autoremove -y && \
    apt-get install -y --no-install-recommends \
    libgtk-3-dev:arm64 \
    libwebkit2gtk-4.1-dev:arm64 \
    libayatana-appindicator3-dev:arm64 \
    librsvg2-dev:arm64 \
    patchelf:arm64

# Install Rust
RUN curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"
RUN rustup target add aarch64-unknown-linux-gnu
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
    CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc \
    CXX_aarch64_unknown_linux_gnu=aarch64-linux-gnu-g++ \
    PKG_CONFIG_PATH=/usr/lib/aarch64-linux-gnu/pkgconfig:$PKG_CONFIG_PATH \
    PKG_CONFIG_ALLOW_CROSS=1

WORKDIR /app