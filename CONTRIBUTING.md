# CONTRIBUTING

Thank you for your interest in contributing to **Clash Verge Rev**!  
This document provides guidelines and instructions to help you set up your development environment and start contributing to the project.

## Development Setup

Before contributing, you need to set up your development environment. Follow these steps:

### Prerequisites

1. **Install Rust and Node.js**: This project requires both Rust and Node.js. Follow the instructions provided [here](https://tauri.app/start/prerequisites/) to install them on your system.

### Setup for Windows Users

> [!NOTE]
>
> If you are using a **Windows ARM** device, you also need to install [LLVM](https://github.com/llvm/llvm-project/releases) (including `clang`) and set the appropriate environment variable.  
> This is because the `ring` crate relies on `clang` for compilation on Windows ARM.

Additional steps for Windows users:

- Ensure Rust and Node.js are added to your system's PATH (usually done during installation, but verify manually if needed).
- Make sure the GNU `patch` tool is installed.
- When setting up the Rust environment, **only use the Windows MSVC toolchain**. To configure:

```bash
rustup target add x86_64-pc-windows-msvc
rustup default stable-x86_64-pc-windows-msvc
```

### Install Node.js Package Manager

Install `pnpm` globally:

```bash
npm install -g pnpm
```

### Install Project Dependencies

Install Node.js packages:

```bash
pnpm install
```

Install Ubuntu-specific packages (if using Ubuntu):

```bash
sudo apt-get install -y libxslt1.1 libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

### Download the Mihomo Core Binary

You have two options to obtain the Mihomo core binary:

1. **Automatically via script**:

```bash
pnpm run prebuild
# Use '--force' (or '-f') to update both the Mihomo core
# and the Clash Verge Rev service to the latest version
pnpm run prebuild --force
```

2. **Manually from the [Mihomo release page](https://github.com/MetaCubeX/mihomo/releases)**:  
   After downloading, rename the binary according to the [Tauri configuration](https://tauri.app/v1/api/config#bundleconfig.externalbin).

### Run the Development Server

To start the development server:

```bash
pnpm dev
# If an instance is already running, use:
pnpm dev:diff
# To use Tauri's built-in dev tool:
pnpm dev:tauri
```

### Build the Project

To build the project:

```bash
pnpm build
```

For a faster build (less optimized, larger binary):

```bash
pnpm build:fast
```

> This uses Rust's fast-release profile to reduce compilation time. The resulting binary may be larger and less performant but is useful for quick testing.  
> Build artifacts will be displayed in the terminal log.

### Clean Build

To clean Rust build artifacts:

```bash
pnpm clean
```

### Portable Version (Windows Only)

To package a portable version after building:

```bash
pnpm portable
```

## Contributing Your Changes

### Before committing your changes

Don't forget to run code style formatting and quality checks:

```bash
# Run both formatting and linting
pnpm check

# Format code only
pnpm fmt

# Check code quality only
pnpm lint
```

### Submitting Your Changes

Once you have made your changes, follow these steps:

1. Fork the repository
2. Create a new branch for your feature or bug fix
3. Commit your changes with clear and concise messages
4. Push your branch to your fork and submit a pull request

We appreciate your contributions and look forward to seeing them in the project!
