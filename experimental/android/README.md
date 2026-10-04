# Experimental Android host for Clash Verge Rev

This directory is a draft Android contribution. It combines an Android VPN host adapted from Clash Meta for Android (CMFA) v2.11.35 with a mobile React interface inspired by Clash Verge Rev. It is not an official mobile release. See [NOTICE.md](NOTICE.md) and [android/UPSTREAM.md](android/UPSTREAM.md) for source revisions, licenses, and binary provenance.

The source tree contains `android/` (Kotlin host, VPN service, and JNI gate source), `web/` (offline mobile interface), and `scripts/` (web asset checks and pinned dependency preparation). It does not contain APKs, native libraries, Geo databases, local SDKs, signing keys, or a copy of Mihomo's upstream source.

## Build a local evaluation APK

Use Node.js 24, npm, JDK 21, Android SDK 35, and an Android NDK with its Windows LLVM toolchain. The Gradle wrapper uses Gradle 8.11.1. In PowerShell, from this directory:

```powershell
npm --prefix web ci
npm --prefix web run build
npm --prefix web test
node scripts/verify-web.mjs
node scripts/sync-web.mjs
./scripts/prepare-android-deps.ps1
./android/build-checked-tun.ps1 -NdkHome $env:ANDROID_NDK_HOME
./android/build.ps1 -JavaHome $env:JAVA_HOME -SdkPath $env:ANDROID_HOME
```

`prepare-android-deps.ps1` downloads the [official CMFA v2.11.35 arm64 APK](https://github.com/MetaCubeX/ClashMetaForAndroid/releases/tag/v2.11.35), verifies its SHA256, and extracts only two JNI libraries and four Geo assets. To use an APK already downloaded from that exact release, pass `-ApkPath <path>`; the same hash checks apply. This script never executes content from the APK. The JNI gate is compiled locally from `android/core/src/main/cpp/checked/tun_gate.c` and requires `libclash.so` from the preceding step. The `android/build.ps1` script packages the web UI and assembles `:app:assembleMetaDebug`; it uses the Android debug signing identity for evaluation.

The checked TUN gate has a separate hash in `android/UPSTREAM.md` for the earlier local build. A new NDK build may have a different hash. Inspect and test the resulting APK before distribution. Do not use a debug APK as a production release.

## Native source rebuild status

`libclash.so` and `libbridge.so` are pinned official release artifacts. The matching Mihomo source is [MetaCubeX/mihomo commit `88dcbf7f1614a67c3b36b848ee3592dfa92ada36`](https://github.com/MetaCubeX/mihomo/tree/88dcbf7f1614a67c3b36b848ee3592dfa92ada36), referenced by CMFA v2.11.35. The host's `android/core/src/foss/golang/go.mod` expects that checkout at `android/core/src/foss/golang/clash`. The original Go/CMake Gradle definition is retained as `android/core/upstream-source-build.gradle.kts` for reference. Rebuilding the two core libraries from Go and NDK has **not** been verified for this contribution; no claim of a complete source rebuild is made.

## Validation boundary

The shared interface built and its bridge tests passed in the prototype work. A local Android debug APK was previously assembled from the pinned release libraries. A subsequent device run confirmed GUI cold start and navigation. VPN permission, profile import, native core readiness, DNS, IPv6, traffic routing, and network switching have not been accepted on device. Build and device evidence must be repeated for any PR revision.

This project uses GPL-3.0-only; included upstream and third-party notices remain in place. Subscription content and credentials must never be committed with source.
