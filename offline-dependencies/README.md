# 离线依赖（offline-dependencies）

> 为了某些网络不好或者不是那么愿意折腾，但是又想自己开发、编译的人准备的。将 `pnpm run check` 替换为 `pnpm run check:offline`。

| 下载链接                                                                                                                 | 目标路径                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| https://nsis.sourceforge.io/mediawiki/images/e/ef/NSIS_Simple_Service_Plugin_Unicode_1.30.zip                            | `${process.env.APPDATA:C:\Users\{username}\AppData\Roaming\Local\NSIS\SimpleSC.dll}` |
| https://github.com/clash-verge-rev/set-dns-script/releases/download/script/set_dns.sh                                    | `../src-tauri/resources/set_dns.sh`                                                  |
| https://github.com/clash-verge-rev/set-dns-script/releases/download/script/unset_dns.sh                                  | `../src-tauri/resources/unset_dns.sh`                                                |
| https://github.com/clash-verge-rev/clash-verge-service/releases/download/x86_64-pc-windows-msvc/uninstall-service.exe    | `../src-tauri/resources/uninstall-service.exe`                                       |
| https://github.com/clash-verge-rev/clash-verge-service/releases/download/x86_64-pc-windows-msvc/install-service.exe      | `../src-tauri/resources/install-service.exe`                                         |
| https://github.com/clash-verge-rev/clash-verge-service/releases/download/x86_64-pc-windows-msvc/clash-verge-service.exe  | `../src-tauri/resources/clash-verge-service.exe`                                     |
| https://github.com/Kuingsmile/uwp-tool/releases/download/latest/enableLoopback.exe                                       | `../src-tauri/resources/enableLoopback.exe`                                          |
| https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat                                         | `../src-tauri/resources/geosite.dat`                                                 |
| https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb                                        | `../src-tauri/resources/Country.mmdb`                                                |
| https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat                                           | `../src-tauri/resources/geoip.dat`                                                   |
| https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha/mihomo-windows-amd64-compatible-alpha-e7e1400.zip | `../src-tauri/sidecar/verge-mihomo-alpha-x86_64-pc-windows-msvc.exe`                 |
| https://github.com/MetaCubeX/mihomo/releases/download/v1.18.7/mihomo-windows-amd64-compatible-v1.18.7.zip                | `../src-tauri/sidecar/verge-mihomo-x86_64-pc-windows-msvc.exe`                       |

- `offline-dependencies/set-dns-script-main.zip` 是 `https://github.com/clash-verge-rev/set-dns-script` 仓库 `main` 分支的源码。
- `offline-dependencies/clash-verge-service-main.zip` 是 `https://github.com/clash-verge-rev/clash-verge-service` 仓库 `main` 分支的源码，若无对应的编译产物，可自行编译。
- `verge-mihomo-alpha`、`verge-mihomo` 和 `clash-verge-service` 需要自行根据系统环境下载对应的文件。
