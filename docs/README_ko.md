<h1 align="center">
  <img src="../src-tauri/icons/icon.png" alt="Clash" width="128" />
  <br>
  <a href="https://github.com/zzzgydi/clash-verge">Clash Verge</a>의 후속 프로젝트
  <br>
</h1>

<h3 align="center">
<a href="https://github.com/tauri-apps/tauri">Tauri</a>로 제작된 Clash Meta GUI.
</h3>

<p align="center">
  언어:
  <a href="../README.md">简体中文</a> ·
  <a href="./README_en.md">English</a> ·
  <a href="./README_es.md">Español</a> ·
  <a href="./README_ru.md">Русский</a> ·
  <a href="./README_ja.md">日本語</a> ·
  <a href="./README_ko.md">한국어</a> ·
  <a href="./README_fa.md">فارسی</a>
</p>

## 미리보기

| 다크                                 | 라이트                                  |
| ------------------------------------ | --------------------------------------- |
| ![다크 미리보기](./preview_dark.png) | ![라이트 미리보기](./preview_light.png) |

## 설치

[릴리스 페이지](https://github.com/clash-verge-rev/clash-verge-rev/releases)에서 사용 중인 플랫폼에 맞는 설치 프로그램을 다운로드하세요.<br>
Windows (x64/x86), Linux (x64/arm64), macOS 10.15+ (Intel/Apple)을 지원합니다.

#### 릴리스 채널 선택

| 채널        | 설명                                                                                 | 링크                                                                                   |
| :---------- | :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| Stable      | 안정 릴리스. 신뢰성이 높아 일상 사용에 적합합니다.                                   | [Release](https://github.com/clash-verge-rev/clash-verge-rev/releases)                 |
| Alpha (EOL) | 퍼블리시 파이프라인 검증에 사용되었던 구 테스트 채널입니다.                          | [Alpha](https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/alpha)         |
| AutoBuild   | 롤링 빌드 채널. 테스트와 피드백 용도로 권장되며, 실험적인 변경이 포함될 수 있습니다. | [AutoBuild](https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/autobuild) |

#### 설치 가이드 및 FAQ

설치 방법, 트러블슈팅, 자주 묻는 질문은 [프로젝트 문서](https://clash-verge-rev.github.io/)를 참고하세요.

---

### 텔레그램 채널

업데이트 공지는 [@clash_verge_rev](https://t.me/clash_verge_re)에서 확인하세요.

## 프로모션

#### [Doggygo VPN — 고성능 글로벌 가속기](https://verge.dginv.click/#/register?code=oaxsAGo6)

- 무료 체험, 할인 요금제, 스트리밍 해제, 선도적인 Hysteria 프로토콜 지원을 갖춘 고성능 해외 네트워크 서비스
- Clash Verge 전용 초대 링크로 가입 시 3일간 매일 1GB 무료 체험 제공: [가입하기](https://verge.dginv.click/#/register?code=oaxsAGo6)
- Clash Verge 전용 20% 할인 코드: `verge20` (선착순 500회)
- 월 15.8위안부터 160GB 제공, 연간 결제 시 추가 20% 할인
- 해외 팀 운영, 높은 신뢰성, 최대 50% 커미션
- 로드밸런싱 클러스터, 고속 전용 회선(구 클라이언트 호환), 매우 낮은 지연, 4K도 쾌적
- 세계 최초 `Hysteria2` 프로토콜 지원 — Clash Verge 클라이언트와 최적의 궁합
- 스트리밍 및 ChatGPT 접근 지원
- 공식 사이트: [https://狗狗加速.com](https://verge.dginv.click/#/register?code=oaxsAGo6)

#### 빌드 인프라 스폰서 — [YXVM 전용 서버](https://yxvm.com/aff.php?aff=827)

본 프로젝트의 빌드 및 릴리스는 YXVM 전용 서버에서 구동됩니다. 빠른 다운로드와 경쾌한 사용감은 탄탄한 하드웨어 덕분입니다.

🧩 YXVM 전용 서버 하이라이트:

- 🌎 최적화된 글로벌 라우팅으로 대폭 빨라진 다운로드
- 🔧 공유 VPS가 아닌 베어메탈 자원으로 최대 성능 제공
- 🧠 프록시 워크로드, Web/CDN 호스팅, CI/CD, 고부하 작업에 적합
- 💡 CN2 / IEPL 등 다양한 데이터센터 옵션, 즉시 사용 가능
- 📦 본 프로젝트가 사용하는 구성도 판매 중 — 동일한 환경을 사용할 수 있습니다
- 🎯 동일한 빌드 환경이 필요하다면 [지금 YXVM 서버 주문](https://yxvm.com/aff.php?aff=827)

## 기능

- 고성능 Rust와 Tauri 2 프레임워크 기반 데스크톱 앱
- 내장 [Clash.Meta (mihomo)](https://github.com/MetaCubeX/mihomo) 코어, `Alpha` 채널 전환 지원
- 테마 색상, 프록시 그룹/트레이 아이콘, `CSS Injection` 등 세련된 UI 커스터마이징
- 프로필 관리(병합 및 스크립트 보조), 구성 문법 힌트 제공
- 시스템 프록시 제어, 가드 모드, `TUN`(가상 네트워크 어댑터) 지원
- 노드/규칙 시각 편집기
- WebDAV 기반 설정 백업 및 동기화

### FAQ

플랫폼별 가이드는 [FAQ 페이지](https://clash-verge-rev.github.io/faq/windows.html)에서 확인하세요.

### 후원

[Clash Verge Rev 개발 후원](https://github.com/sponsors/clash-verge-rev)

## 개발

자세한 기여 가이드는 [CONTRIBUTING.md](../CONTRIBUTING.md)를 참고하세요.

**Tauri** 필수 구성 요소를 설치한 뒤 아래 명령으로 개발 서버를 실행합니다:

```shell
pnpm i
pnpm run prebuild
pnpm dev
```

## 기여

Issue와 Pull Request를 환영합니다!

## 감사의 말

Clash Verge Rev는 다음 프로젝트에 기반하거나 영향을 받았습니다:

- [zzzgydi/clash-verge](https://github.com/zzzgydi/clash-verge): Windows / macOS / Linux용 Tauri 기반 Clash GUI
- [tauri-apps/tauri](https://github.com/tauri-apps/tauri): 웹 프론트엔드로 더 작고 빠르고 안전한 데스크톱 앱을 빌드
- [Dreamacro/clash](https://github.com/Dreamacro/clash): Go로 작성된 규칙 기반 터널
- [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo): Go로 작성된 규칙 기반 터널
- [Fndroid/clash_for_windows_pkg](https://github.com/Fndroid/clash_for_windows_pkg): Windows / macOS용 Clash GUI
- [vitejs/vite](https://github.com/vitejs/vite): 차세대 프론트엔드 툴링, 매우 빠른 DX

## 라이선스

GPL-3.0 라이선스. 자세한 내용은 [LICENSE](../LICENSE)를 참고하세요.
