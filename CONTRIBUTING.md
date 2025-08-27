# CONTRIBUTING

Thank you for your interest in contributing to Clash Verge Self! This document provides guidelines and instructions to help you set up your development environment and start contributing.

## Development Setup

Before you start contributing to the project, you need to set up your development environment. Here are the steps you need to follow:

### Prerequisites

1. **Install Rust and Node.js**: Our project requires both Rust and Node.js. Please follow the instructions provided [here](https://tauri.app/v1/guides/getting-started/prerequisites) to install them on your system.

2. **Install typos and prek**: execute the `pnpm i` command to check and install them.
   - `typos`: Source code spell checker.
   - `prek`: Git pre-commit hooks.

### Setup for Windows Users

If you're a Windows user, you may need to perform some additional steps:

- Make sure to add Rust and Node.js to your system's PATH. This is usually done during the installation process, but you can verify and manually add them if necessary.
- The gnu `patch` tool should be installed

### Install Node.js Packages

After installing Rust and Node.js, install the necessary Node.js packages:

```shell
pnpm i
```

### Download the Clash Binary

You have two options for downloading the clash binary:

- Automatically download it via the provided script:

  ```shell
  pnpm check

  # Use '--force' to force update to the latest version
  pnpm check --force

  # Use '--alpha' to download alpha version of Clash Verge Service
  pnpm check --alpha

  # Also, you can use '--alpha' and '--force' together
  pnpm check --alpha --force
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

If you want to build the project, use:

```shell
pnpm build
```

## Contributing Your Changes

Once you have made your changes:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Commit your changes with clear and concise commit messages.
4. Push your branch to your fork and submit a pull request to our repository.

We appreciate your contributions and look forward to your active participation in our project!
