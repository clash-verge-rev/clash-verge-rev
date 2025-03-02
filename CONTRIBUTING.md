# CONTRIBUTING

Thank you for your interest in contributing to Clash Verge Rev! This document provides guidelines and instructions to help you set up your development environment and start contributing.

## Development Setup

Before you start contributing to the project, you need to set up your development environment. Here are the steps you need to follow:

### Prerequisites

1. **Install Rust and Node.js**: Our project requires both Rust and Node.js. Please follow the instructions provided [here](https://tauri.app/v1/guides/getting-started/prerequisites) to install them on your system.

### Setup for Windows Users

If you're a Windows user, you may need to perform some additional steps:

- Make sure to add Rust and Node.js to your system's PATH. This is usually done during the installation process, but you can verify and manually add them if necessary.
- The gnu `patch` tool should be installed

When you setup `Rust` environment, Only use toolchain with `Windows MSVC` , to change settings follow command:

```shell
rustup target add x86_64-pc-windows-msvc
rustup set default-host x86_64-pc-windows-msvc
```

### Install Node.js Package

After installing Rust and Node.js, install the necessary Node.js and Node Package Manager:

```shell
npm install pnpm -g
```

### Install Dependencies

```shell
pnpm install
```

### Download the Mihomo Core Binary

You have two options for downloading the clash binary:

- Automatically download it via the provided script:
  ```shell
  pnpm run check
  # Use '--force' to force update to the latest version
  # pnpm run check --force
  ```
- Manually download it from the [Mihomo release](https://github.com/MetaCubeX/mihomo/releases). After downloading, rename the binary according to the [Tauri configuration](https://tauri.app/v1/api/config#bundleconfig.externalbin).

### Run the Development Server

To run the development server, use the following command:

```shell
pnpm dev
# If an app instance already exists, use a different command
pnpm dev:diff
```

### Build the Project

To build this project:

```shell
pnpm build
```

For a faster build, use the following command

```shell
pnpm build:fast
```

This uses Rust's fast-release profile which significantly reduces compilation time by disabling optimization and LTO. The resulting binary will be larger and less performant than the standard build, but it's useful for testing changes quickly.

The `Artifacts` will display in the `log` in the Terminal.

### Build clean

To clean rust build:

```shell
pnpm clean
```

### Portable Version (Windows Only)

To package portable version after the build:

```shell
pnpm portable
```

## Contributing Your Changes

Once you have made your changes:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Commit your changes with clear and concise commit messages.
4. Push your branch to your fork and submit a pull request to our repository.

We appreciate your contributions and look forward to your active participation in our project!
