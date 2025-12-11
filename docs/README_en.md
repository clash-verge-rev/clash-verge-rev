<h1 align="center">
  <img src="../src-tauri/icons/icon.png" alt="Clash" width="128" />
  <br>
  Continuation of <a href="https://github.com/zzzgydi/clash-verge">Clash Verge</a>
  <br>
</h1>

<h3 align="center">
A Clash Meta GUI built with <a href="https://github.com/tauri-apps/tauri">Tauri</a>.
</h3>

<p align="center">
  Languages:
  <a href="../README.md">简体中文</a> ·
  <a href="./README_en.md">English</a> ·
  <a href="./README_es.md">Español</a> ·
  <a href="./README_ru.md">Русский</a> ·
  <a href="./README_ja.md">日本語</a> ·
  <a href="./README_ko.md">한국어</a> ·
  <a href="./README_fa.md">فارسی</a>
</p>

## Preview

| Dark                                | Light                                 |
| ----------------------------------- | ------------------------------------- |
| ![Dark Preview](./preview_dark.png) | ![Light Preview](./preview_light.png) |

## Install

Visit the [Release page](https://github.com/clash-verge-rev/clash-verge-rev/releases) to download the installer that matches your platform.<br>
We provide packages for Windows (x64/x86), Linux (x64/arm64), and macOS 10.15+ (Intel/Apple).

#### Choosing a Release Channel

| Channel     | Description                                                           | Link                                                                                   |
| :---------- | :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| Stable      | Official builds with high reliability, ideal for daily use.           | [Release](https://github.com/clash-verge-rev/clash-verge-rev/releases)                 |
| Alpha (EOL) | Legacy builds used to validate the publish pipeline.                  | [Alpha](https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/alpha)         |
| AutoBuild   | Rolling builds for testing and feedback. Expect experimental changes. | [AutoBuild](https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/autobuild) |

#### Installation Guides & FAQ

Read the [project documentation](https://clash-verge-rev.github.io/) for install steps, troubleshooting, and frequently asked questions.

---

### Telegram Channel

Join [@clash_verge_rev](https://t.me/clash_verge_re) for update announcements.

## Promotion

#### [Doggygo VPN — Performance-oriented global accelerator](https://verge.dginv.click/#/register?code=oaxsAGo6)

- High-performance overseas network service with free trials, discounted plans, streaming unlocks, and first-class Hysteria protocol support.
- Register through the exclusive Clash Verge link to get a 3-day trial with 1 GB of traffic per day: [Sign up](https://verge.dginv.click/#/register?code=oaxsAGo6)
- Exclusive 20% off coupon for Clash Verge users: `verge20` (limited to 500 uses)
- Discounted bundle from ¥15.8 per month for 160 GB, plus an additional 20% off for yearly billing
- Operated by an overseas team with reliable service and up to 50% revenue share
- Load-balanced clusters with high-speed dedicated routes (compatible with legacy clients), exceptionally low latency, smooth 4K playback
- First global provider to support the `Hysteria2` protocol—perfect fit for the Clash Verge client
- Supports streaming services and ChatGPT access
- Official site: [https://狗狗加速.com](https://verge.dginv.click/#/register?code=oaxsAGo6)

#### Build Infrastructure Sponsor — [YXVM Dedicated Servers](https://yxvm.com/aff.php?aff=827)

Our builds and releases run on YXVM dedicated servers that deliver premium resources, strong performance, and high-speed networking. If downloads feel fast and usage feels snappy, it is thanks to robust hardware.

🧩 Highlights of YXVM Dedicated Servers:

- 🌎 Optimized global routes for dramatically faster downloads
- 🔧 Bare-metal resources instead of shared VPS capacity for maximum performance
- 🧠 Great for proxy workloads, hosting web/CDN services, CI/CD pipelines, or any high-load tasks
- 💡 Ready to use instantly with multiple datacenter options, including CN2 and IEPL
- 📦 The configuration used by this project is on sale—feel free to get the same setup
- 🎯 Want the same build environment? [Order a YXVM server today](https://yxvm.com/aff.php?aff=827)

## Features

- Built on high-performance Rust with the Tauri 2 framework
- Ships with the embedded [Clash.Meta (mihomo)](https://github.com/MetaCubeX/mihomo) core and supports switching to the `Alpha` channel
- Clean, polished UI with theme color controls, proxy group/tray icons, and `CSS Injection`
- Enhanced profile management (Merge and Script helpers) with configuration syntax hints
- System proxy controls, guard mode, and `TUN` (virtual network adapter) support
- Visual editors for nodes and rules
- WebDAV-based backup and sync for configurations

### FAQ

See the [FAQ page](https://clash-verge-rev.github.io/faq/windows.html) for platform-specific guidance.

### Donation

[Support Clash Verge Rev development](https://github.com/sponsors/clash-verge-rev)

## Development

See [CONTRIBUTING.md](../CONTRIBUTING.md) for detailed contribution guidelines.

After installing all **Tauri** prerequisites, run the development shell with:

```shell
pnpm i
pnpm run prebuild
pnpm dev
```

## Contributions

Issues and pull requests are welcome!

## Acknowledgement

Clash Verge Rev builds on or draws inspiration from these projects:

- [zzzgydi/clash-verge](https://github.com/zzzgydi/clash-verge): A Tauri-based Clash GUI for Windows, macOS, and Linux.
- [tauri-apps/tauri](https://github.com/tauri-apps/tauri): Build smaller, faster, more secure desktop apps with a web frontend.
- [Dreamacro/clash](https://github.com/Dreamacro/clash): A rule-based tunnel written in Go.
- [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo): A rule-based tunnel written in Go.
- [Fndroid/clash_for_windows_pkg](https://github.com/Fndroid/clash_for_windows_pkg): A Clash GUI for Windows and macOS.
- [vitejs/vite](https://github.com/vitejs/vite): Next-generation frontend tooling with blazing-fast DX.

## License

GPL-3.0 License. See the [license file](../LICENSE) for details.
