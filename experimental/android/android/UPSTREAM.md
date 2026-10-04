# Android host provenance

This is an independent GPL-3.0 port. It is not an official Clash Verge Rev or MetaCubeX release.

Native Android host, profile database, subscription validation, Binder services, background VPN, access control and advanced settings are based on MetaCubeX/ClashMetaForAndroid v2.11.35:
https://github.com/MetaCubeX/ClashMetaForAndroid/tree/v2.11.35
Commit: a55827bfdd79f69ded8cf75c90293d2b7cb7e5a1.
Retained license: LICENSE. Upstream NOTICE and PRIVACY_POLICY.md are preserved.

The matching Mihomo core source is available from:
https://github.com/MetaCubeX/mihomo/tree/88dcbf7f1614a67c3b36b848ee3592dfa92ada36
This is the exact gitlink in the CMFA v2.11.35 tag. It is not vendored in this contribution. For a source rebuild, check out that exact commit into `core/src/foss/golang/clash` and retain its GPL-3.0 license.

## Pinned native binary inputs

The earlier local arm64 host used libbridge.so, libclash.so, and Geo assets extracted from this official release APK:
https://github.com/MetaCubeX/ClashMetaForAndroid/releases/download/v2.11.35/cmfa-2.11.35-meta-arm64-v8a-release.apk
APK SHA256: af7f05d8801798a8e75de682e5f67070138becb8623b7a341c3e5cd042a3753d

- core/src/main/jniLibs/arm64-v8a/libbridge.so: 944b9b1201641fdd468ddf09e64d9c5e9be24587737e3a1cac43ec91e5c3a95b
- core/src/main/jniLibs/arm64-v8a/libclash.so: bd30767c01b4e255279242fc77008671bb08db330c0a106a0144ecebaa482721
- app/src/main/assets/geoip.metadb: 76ad4ba5d45b1d35b57c3ef26a31c420f7e5afa1e03baf18a47f2d2c933f783b
- app/src/main/assets/geosite.dat: bff76f6b4d87c3a4c7d9612b926e762b21ba4fe2c5bf8c5a43af25fe8de71b7e
- app/src/main/assets/ASN.mmdb: d8a649084d78e662cc7091ec64840c4ab534eef33e573649697fee253f2f9f4c
- app/src/main/assets/BundleMRS.7z: 0f02c1038b9a41d9961a1bc5596b43b8bfb2cd7ba635e09c7e85c00f07608d15

Native Kotlin/JNI APIs are kept matched to this pinned release. Changing core binaries independently of this source is unsupported.

## Checked TUN JNI gate

The upstream void nativeStartTun JNI entry point drops the Go startTun error code. This port adds core/src/main/cpp/checked/tun_gate.c and CheckedTun.kt, so the same pinned libclash returns its actual error code and unsuccessful TUN attachment throws before readiness is published. The original libbridge.so remains unchanged. The Go startTun path owns and releases its global callback; this gate never frees it a second time.

The gate binary is not included in this source tree. Run `build-checked-tun.ps1` with an Android NDK LLVM toolchain after preparing pinned `libclash.so`; the NDK is required for an evaluation APK build. An earlier local gate build had SHA256 `2e01423f82b0fa843eef958b658d66ead0e31645d5ae7420af5206e0e4a1ac14`, but a new NDK build may differ and must be verified independently.

The Android JNI header is retained with its Apache-2.0 notice, downloaded from the AOSP official source:
https://android.googlesource.com/platform/libnativehelper/+/refs/heads/main/include_jni/jni.h
Header SHA256: 2a3cea5e4306872202592406593f6465f07b848d75ed03ad07e2936479867f0a.

The launcher image is from Clash Verge Rev's GPL repository, src-tauri/icons/128x128.png, copied to drawable-nodpi/verge_launcher.png. The root project NOTICE records that upstream revision.
The original Go/CMake build definition is preserved as core/upstream-source-build.gradle.kts for reference. For a native core source rebuild, fetch the exact Mihomo commit above and use the original upstream build with its declared Go/NDK/CMake environment, then copy the matching binaries into jniLibs. That complete source rebuild has not been verified. The current APK assembly path uses the verified official release libraries plus a locally compiled NDK gate.

## Port changes

- MobileActivity.kt hosts only packaged web assets. It blocks remote navigation/resources and frames, disables file/content access, applies hash-based inline-script CSP, and exposes only the JSON request bridge.
- Real methods implement persisted profile import/validation, profile activation, HTTPS subscription update, VPN permission/start/stop, selectors, mode and bounded sanitized logs.
- The status provider publishes actual service/VPN-service lifetimes, successful checked TUN attachment, loaded profile UUID and load generation. Running requires all three: live VPN service, TUN success and loaded configuration. Start waits for these; stop waits for the service to end. Profile reload waits for a new successful load generation.
- Single-proxy latency is explicitly unsupported by this bridge; the upstream native interface only exposes group health checks. Existing measured native delay values remain visible.
- canChooseFile is false: paste YAML or import an HTTPS subscription. This first host does not advertise a file picker it has not implemented.
- Native advanced settings remain available via native.settings and native.home.
- Application ID io.github.vergemobile keeps data separate from existing Clash/Clash Verge installations.
- Backups are disabled because profiles can contain subscription and node credentials.
- Build targets arm64-v8a only, using Gradle 8.11.1. This is a debug-signed evaluation build, not a production signing identity.

Run `../scripts/prepare-android-deps.ps1` before building to verify and extract the official APK inputs. Build the shared web UI and run `../scripts/sync-web.mjs`. Run `build-checked-tun.ps1` with the Android NDK, then `build.ps1` with JDK 21 and Android SDK 35. A full Go/NDK native core source rebuild remains unverified.

## Acceptance boundary

A successful APK build only confirms compilation and packaging. Real device acceptance must test: import invalid/valid YAML; HTTPS subscription update; activate/reload; VPN consent denied/granted; real HTTP and WebSocket traffic; DNS and IPv6 behavior; background/lockscreen service; network switch; stop and route restoration. No device installation or VPN activation is performed by the build.

## Local build evidence (2026-10-03)

Gradle 8.11.1 and isolated Temurin JDK 21.0.12.1 completed app:assembleMetaDebug --offline --no-daemon --console=plain: BUILD SUCCESSFUL in 1m 36s, 147 tasks (22 executed, 125 up-to-date). Before the offline build, missing official Gradle dependencies were downloaded using the existing proxy for that build process only; no proxy setting was written into project or global Gradle configuration. Gradle provisioned the missing Android SDK Build Tools 35.0.0 through its standard SDK dependency handling.

Historical APK: app/build/outputs/apk/meta/debug/verge-mobile-0.1.0-meta-arm64-v8a-debug.apk.
Size: 57,436,730 bytes.
SHA256: d6cf3fd53e9138e716ce1f5c66d60245c41c690479b561bc0f5b56fefa0c1225.

APK manifest checks confirm application ID io.github.vergemobile, version code 100, version name 0.1.0.debug, label Verge Mobile, min SDK 21, target SDK 35, and only arm64-v8a native code. The MAIN/LAUNCHER alias targets com.github.kr328.clash.MobileActivity. apksigner verifies both v1 and v2 signatures; this is the Android Debug evaluation certificate, not a production signer.

The historical APK packaged assets/web/index.html at 306,455 bytes, SHA256 4d3ee214534dbdca1360b20947019008b11dbb419d3f51815ffa8e96509e3e20. Its three packaged native libraries matched their recorded hashes. A later device run confirmed GUI cold start and navigation. VPN permission, native core readiness, DNS, IPv6, and actual traffic remain unverified.
