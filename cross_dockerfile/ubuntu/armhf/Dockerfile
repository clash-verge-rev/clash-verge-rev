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
    g++-arm-linux-gnueabihf libc6-dev-armhf-cross \
    ca-certificates curl wget gnupg build-essential pkg-config file && \
    rm -rf /var/lib/apt/lists/*

RUN dpkg --add-architecture armhf && \
    apt-get update && \
    apt-get autoremove -y && \
    apt-get install -y --no-install-recommends \
    libgtk-3-dev:armhf \
    libwebkit2gtk-4.1-dev:armhf \
    libayatana-appindicator3-dev:armhf \
    librsvg2-dev:armhf \
    patchelf:armhf

# Install Rust
RUN curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"
RUN rustup target add armv7-unknown-linux-gnueabihf
ENV CARGO_TARGET_ARMV7_UNKNOWN_LINUX_GNUEABIHF_LINKER=arm-linux-gnueabihf-gcc \
    CC_armv7_unknown_linux_gnueabihf=arm-linux-gnueabihf-gcc \
    CXX_armv7_unknown_linux_gnueabihf=arm-linux-gnueabihf-g++ \
    PKG_CONFIG_PATH=/usr/lib/arm-linux-gnueabihf/pkgconfig:$PKG_CONFIG_PATH \
    PKG_CONFIG_ALLOW_CROSS=1

WORKDIR /app