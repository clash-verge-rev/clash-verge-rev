FROM debian:trixie

RUN rm -f /etc/apt/sources.list.d/debian.sources && \
    rm -f /etc/apt/sources.list && \
    echo "deb http://deb.debian.org/debian/ trixie main contrib non-free non-free-firmware" | tee -a /etc/apt/sources.list && \
    echo "deb http://deb.debian.org/debian/ trixie-updates main contrib non-free non-free-firmware" | tee -a /etc/apt/sources.list && \
    echo "deb http://deb.debian.org/debian/ trixie-backports main contrib non-free non-free-firmware" | tee -a /etc/apt/sources.list && \
    echo "deb http://deb.debian.org/debian-security/ trixie-security main contrib non-free non-free-firmware" | tee -a /etc/apt/sources.list

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc-multilib g++-multilib \
    ca-certificates curl wget gnupg build-essential pkg-config file && \
    rm -rf /var/lib/apt/lists/*

RUN dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    libgtk-3-dev:i386 \
    libwebkit2gtk-4.1-dev:i386 \
    libayatana-appindicator3-dev:i386 \
    librsvg2-dev:i386 \
    patchelf:i386

# Install Rust
RUN curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"
RUN rustup target add i686-unknown-linux-gnu
ENV PKG_CONFIG_PATH=/usr/lib/i386-linux-gnu/pkgconfig:$PKG_CONFIG_PATH

WORKDIR /app