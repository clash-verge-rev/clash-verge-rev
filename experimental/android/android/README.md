# Verge Mobile Android

Independent GPL-3.0 Android port inspired by Clash Verge Rev, with a packaged React mobile UI and the real CMFA/Mihomo background VPN implementation. This is not an official upstream release.

Requires JDK 21, Android SDK 35, an Android NDK with LLVM tools, and current Android System WebView. The pinned upstream native inputs target arm64-v8a only. Evaluation APKs use a debug signing key and the independent application ID `io.github.vergemobile` (version `0.1.0.debug`, code 100).

From the parent directory, build the web UI, run `scripts/prepare-android-deps.ps1` to verify and extract the pinned official APK inputs, and run `scripts/sync-web.mjs`. Then `cd android` and, in PowerShell, build the JNI gate with `./build-checked-tun.ps1 -NdkHome <Android-NDK-path>` before running `./build.ps1 -JavaHome <JDK21-path> -SdkPath <Android-SDK-path>`. Alternatively, set `ANDROID_NDK_HOME` and pass `-RebuildCheckedTun` to `build.ps1`. The output is under `app/build/outputs/apk/meta/debug/`. Build dependencies require network access when absent from the local Gradle cache. There is no persistent proxy configuration in this project.

The shared UI comes from `../web/dist/index.html` and is copied into the packaged assets by `build.ps1`. The TUN-check JNI gate is built locally from `core/src/main/cpp/checked/tun_gate.c` with the Android NDK; it links against pinned `libclash.so`. The `libclash.so` and `libbridge.so` inputs come from a SHA256-verified official CMFA APK and are not stored in this source tree. The full Mihomo source is not vendored: `UPSTREAM.md` identifies its exact commit and license. A complete Go/NDK rebuild of the core libraries has not been verified.

Real bridge functions cover persisted YAML/HTTPS profile import and validation, activation/update, VPN consent and lifecycle, proxy selectors, routing mode, and sanitized logs. Single-node delay testing and the WebView file picker are not advertised in this first host. Paste YAML or use an HTTPS subscription. Advanced CMFA native settings remain available from the mobile settings page.

`UPSTREAM.md` records exact upstream sources, native hashes, the checked TUN gate, and acceptance limits. `UPSTREAM-README.md` preserves the original upstream README. `LICENSE`, `NOTICE`, and each dependency's retained notices apply.

APK compilation and static packaging checks do not confirm device operation. A prior device run confirmed GUI cold start and navigation. VPN consent, real traffic, DNS/IPv6, WebSocket, background persistence, network switching, stopping, and route restoration still require Android ARM64 device validation. No installation or network activation is part of the local build.
