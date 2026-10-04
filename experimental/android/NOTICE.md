# Upstream attribution

Verge Mobile is an independent, local development port. It is not an official Clash Verge Rev release.

- **Clash Verge Rev**: https://github.com/clash-verge-rev/clash-verge-rev, `dev` commit `ea509b82363a40c3c32e951d7ce9d66d66da411f`, GPL-3.0-only. The mobile UI follows its profile/proxy/mode/log organization, derives the proxy model subset from `src/types/global.d.ts`, and includes `src/assets/image/icon_light.svg` and `src-tauri/icons/128x128.png`. The React mobile layout and platform bridge are newly implemented. The upstream desktop Rust service and full desktop pages are not part of the mobile runtime.
- **Clash Meta for Android**: https://github.com/MetaCubeX/ClashMetaForAndroid. The Android host reuses the upstream profile database, subscription validation, Mihomo JNI service and Android VPN integration. Exact release, native artifact provenance and modifications are recorded inside `android`.
- **Mihomo**: https://github.com/MetaCubeX/mihomo, GPL-3.0. The Android native engine source is pinned to commit `88dcbf7f1614a67c3b36b848ee3592dfa92ada36`; the official release APK and extracted library hashes are recorded in `android/UPSTREAM.md`.

The root GPL-3.0 license and each included project's copyright/license notices apply. Web dependencies retain their own licenses, referenced by `web/package-lock.json`.
