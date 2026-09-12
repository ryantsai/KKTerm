<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>터미널, SSH/SFTP, RDP/VNC, 파일, 웹, IT Ops, 승인 기반 AI 어시스턴트를 하나로 모은 크로스 플랫폼 데스크톱 Workspace.</strong>
</p>

<p align="center">
  <em>작업 표시줄이 라스베이거스 슬롯머신처럼 보일 필요는 없으니까요.</em>
</p>

<p align="center">
  <sub>이름은 대만 시스템 관리자가 서버가 잘 작동하길 바라며 올려 두는 초록색 코코넛 맛 과자 <strong>乖乖 (Kuāi Kuāi)</strong>에서 따왔습니다.</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">최신 KKTerm 다운로드</a></strong>
</p>

> 💚 **KKTerm은 독립 개발자가 만드는 무료 로컬-퍼스트 앱입니다. 텔레메트리도 구독도 없습니다.**
> KKTerm이 매일 시간을 아껴준다면, **Microsoft Store 또는 Mac App Store에서 구매**해 주시는 것이 가장 큰 지원이 됩니다. **일회성 결제, 구독 없음**——GitHub 무료 빌드와 동일한 앱이며, 수익금은 버그 수정, 새 기능, 서명된 자동 업데이트 빌드 개발에 직접 사용됩니다.
>
> <p align="center">
>   <a href="https://apps.microsoft.com/detail/9nvqc5cnwwjk?hl=zh-TW&gl=HK"><img src="https://img.shields.io/badge/Microsoft_Store-Get_KKTerm_%E2%80%A2_One--time_payment-0078D4?style=for-the-badge&logo=microsoftstore&logoColor=white" alt="Microsoft Store에서 KKTerm 받기——일회성 결제, 구독 없음" /></a>
>   <a href="https://apps.apple.com/tw/app/kkterm/id6806710046?mt=12"><img src="https://img.shields.io/badge/Mac_App_Store-Download_KKTerm_%E2%80%A2_One--time_payment-000000?style=for-the-badge&logo=apple&logoColor=white" alt="Mac App Store에서 KKTerm 다운로드——일회성 결제, 구독 없음" /></a>
> </p>
>
> <p align="center"><sub>무료 빌드를 원하시면 GitHub 최신 릴리스에서 받으세요——가입도 조건도 없습니다.</sub></p>

<p align="center">
  <a href="https://github.com/ryantsai/KKTerm/stargazers">
    <img src="https://img.shields.io/github/stars/ryantsai/KKTerm?style=for-the-badge&logo=github&color=ffd33d" alt="GitHub stars" />
  </a>
  <a href="https://github.com/ryantsai/KKTerm/network/members">
    <img src="https://img.shields.io/github/forks/ryantsai/KKTerm?style=for-the-badge&logo=github&color=8a63d2" alt="GitHub forks" />
  </a>
  <a href="https://github.com/ryantsai/KKTerm/releases">
    <img src="https://img.shields.io/github/downloads/ryantsai/KKTerm/total?style=for-the-badge&logo=github&color=0969da" alt="GitHub downloads" />
  </a>
  <a href="https://github.com/ryantsai/KKTerm/issues">
    <img src="https://img.shields.io/github/issues/ryantsai/KKTerm?style=for-the-badge&logo=github&color=2ea043" alt="Open issues" />
  </a>
  <a href="https://github.com/ryantsai/KKTerm/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-blue?style=for-the-badge" alt="MIT License with Commons Clause" />
  </a>
  <a href="https://buymeacoffee.com/ryantsai">
    <img src="https://img.shields.io/badge/Buy_Me_a_Coffee-%E2%98%95-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="커피 한 잔 사주기" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="크로스 플랫폼 데스크톱" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="로컬 우선, 텔레메트리 없음" />
  <br />
  <sub>
    <a href="README.md">English</a> ·
    <a href="README.zh-TW.md">繁體中文</a> ·
    <a href="README.zh-CN.md">简体中文</a> ·
    <a href="README.ja.md">日本語</a> ·
    <strong>한국어</strong> ·
    <a href="README.fr.md">Français</a> ·
    <a href="README.de.md">Deutsch</a> ·
    <a href="README.es.md">Español</a> ·
    <a href="README.es-MX.md">Español (MX)</a> ·
    <a href="README.it.md">Italiano</a> ·
    <a href="README.pt-BR.md">Português (BR)</a> ·
    <a href="README.th.md">ไทย</a> ·
    <a href="README.id.md">Bahasa Indonesia</a> ·
    <a href="README.vi.md">Tiếng Việt</a>
  </sub>
</p>

---

## 왜 "KKTerm"인가?

KKTerm은 **Kuai Kuai Term**입니다. 대만 시스템 관리자가 서버에 올려 두는 초록색 乖乖에서 따온 이름으로, 중요한 장비가 조용하고 안정적으로 잘 작동하길 바라는 뜻을 담았습니다.

## 하나의 창, 모든 연결

KKTerm은 로컬 셸, SSH/SFTP, FTP/FTPS, Telnet, 시리얼, RDP/VNC, URL 연결, 로컬 파일 탐색기와 문서 뷰어를 하나의 데스크톱 Workspace에 모읍니다. 하나의 Tab에 서로 다른 Pane 유형을 섞을 수 있어 터미널, 파일 브라우저, 웹 UI, 원격 화면을 같은 작업 안에 둘 수 있습니다.

| 용도 | KKTerm |
| --- | --- |
| 로컬 셸 | PowerShell, cmd, WSL |
| 원격 접속 | SSH, Telnet, 시리얼, RDP, VNC |
| 파일과 웹 | SFTP, FTP/FTPS, 로컬 파일, 내장 URL 연결 |
| 문서 | tail-follow 로그, 텍스트, CSV, 이미지, PDF |

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="하나의 KKTerm Tab에서 SSH, SFTP, 터미널, URL, RDP Pane을 함께 사용하는 화면" width="720" />
</p>

## 터미널 주변의 업무까지

- **Workspace** — Tab과 Pane 혼합, 이름 있는 Workspace, tmux 재연결, Connection Notes, Git Browser, File Compare.
- **AI 어시스턴트** — Session, Dashboard, IT Ops, Custom Module을 위한 승인 기반 도구와 첨부 파일, 터미널 전송, MCP, 재사용 가능한 Assistant Skills.
- **Dashboard** — 전환 가능한 View와 드래그·크기 조절이 가능한 기본 또는 AI 생성 Widget. App Launcher, 실시간 Connection 패널, Notes, 사용량 미터, 유틸리티 도구를 제공합니다.
- **IT Ops** — Site의 Server Room 및 Rack 토폴로지(elevation, floor plan, 2.5D View), Host 인벤토리와 연결성 검사, 재사용 가능한 Script/Playbook Task, SSH/WinRM/PsExec Batch Run, IPAM, VLAN, Network Map, 실행 기록, PDF/CSV 내보내기.
- **Screenshots** — 영역, 창, 전체 데스크톱을 캡처하고 로컬 라이브러리나 클립보드에 저장합니다. 일괄 크기 조절·변환과 자르기, 도형, 텍스트, 모자이크 주석도 지원합니다.
- **Custom Modules** — Settings에서 격리된 `.kkmod` 패키지를 설치하고 선언된 권한을 검토한 뒤 Activity Rail 목적지로 추가할 수 있습니다. 업데이트, 롤백, 저장 공간, 제거도 관리합니다. 저장소에는 Excalidraw, BentoPDF, OpenFlowKit, TiddlyWiki 통합이 포함되어 있습니다.
- **Install Helper(Windows)** — KKTerm을 떠나지 않고 도구와 지원되는 로컬 웹 앱·서비스를 검색, 설치, 업데이트, 제거합니다.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="KKTerm IT Ops Server Room Rack elevation과 장치 상태 표시" width="720" />
</p>

## 내 작업공간으로 꾸미기

Dashboard View, 터미널 Connection, 문서 뷰어, IT Ops drill view는 하나의 배경 선택기를 공유합니다. 단색·그라디언트 프리셋, 로컬 이미지·동영상, 또는 **84개의 내장 동적 배경**을 고를 수 있습니다. 바다와 날씨, WebGL 장면, 우주, 네트워크 그래픽, 추상 모션까지 포함합니다. 숨겨졌거나 화면 밖에 있는 장면은 일시 중지되고 렌더링 리소스를 해제합니다. 색상 테마, 터미널 외관, 사용자 지정 글꼴, Connection별 배경도 설정할 수 있습니다.

<p align="center">
  <img src="docs/assets/screenshots/backgrounds.png" alt="KKTerm 동적 배경 선택기" width="720" />
</p>

## 실제 화면

<p align="center">
  <img src="docs/assets/demo.gif" alt="KKTerm 데모" width="720" />
</p>

## KKTerm 받기

**개발 후원(권장):** [Microsoft Store](https://apps.microsoft.com/detail/9nvqc5cnwwjk?hl=zh-TW&gl=HK)(Windows) 또는 [Mac App Store](https://apps.apple.com/tw/app/kkterm/id6806710046?mt=12)(macOS)에서 KKTerm을 받으세요. 일회성 결제, 구독 없음——GitHub 무료 빌드와 동일한 앱이며, 서명된 패키지와 스토어 자동 업데이트가 제공됩니다. 수익금은 지속적인 개발에 직접 사용됩니다.

**무료 빌드:** [최신 릴리스](https://github.com/ryantsai/KKTerm/releases/latest)에서 Windows, macOS 또는 Linux용 버전을 다운로드하세요. Windows에는 설치 실행 파일과 x64/ARM64 포터블 ZIP이 제공됩니다. 포터블 ZIP은 쓰기 가능한 로컬 폴더나 이동식 드라이브에 압축을 풀고, 네트워크 공유 위치에서 실행하지 마세요. 실행 전에 옆에 있는 `.sha256` 파일을 확인하세요.

소스에서 빌드하려면 먼저 [`CONTRIBUTING.md`](CONTRIBUTING.md)를 읽어 주세요.

### 스토어 버전의 솔직한 제한 사항

**Mac App Store** 버전은 Apple의 App Sandbox 안에서 동작하므로 무료 빌드와 100% 동일하지 않습니다.

- 로컬 셸도 샌드박스에 갇힙니다——`$HOME`은 컨테이너이며 dotfiles, `~/.ssh`, Homebrew 도구를 사용할 수 없습니다. 원격 SSH 세션에는 영향이 없으며, 제한 없는 로컬 셸이 필요하면 직접 다운로드한 macOS 빌드를 사용하세요.
- 실제 폴더는 네이티브 선택기로 한 번만 허용하면 되며(허용은 재시작 후에도 기억됩니다). SFTP 로컬 창은 컨테이너의 Documents에서 시작하고, 스크린샷은 기본적으로 컨테이너 폴더에 저장됩니다.
- 동영상 녹화와 종료 타이머 메뉴가 없으며, URL 연결의 첫 다운로드 때는 대상 폴더를 묻습니다.
- 업데이트는 App Store를 통해서만 제공됩니다(인앱 업데이터 없음). 샌드박스 안의 MCP 클라이언트는 내장 브리지에 연결할 수 없고, ping은 TCP 프로브로 대체됩니다. 직접 다운로드 빌드에서 옮겨 왔다면 개인정보 보호 및 보안의 화면 기록에서 이전 항목을 삭제하고 다시 승인하세요.

**Microsoft Store** 버전은 완전한 Windows 빌드이며, 차이점은 2가지뿐입니다. 7일 평가판(실행할 때마다 라이선스를 한 번만 확인하고, 스토어에 연결되지 않아도 앱이 차단되지 않음)과 스토어를 통한 업데이트입니다.

자세한 내용은 [`docs/MAC_APP_STORE.md`](docs/MAC_APP_STORE.md)와 매뉴얼 2, 5, 7, 8, 11, 14, 15장을 참고하세요.

## 기여, 후원, 문서

기여와 버그 신고를 환영합니다. [`CONTRIBUTING.md`](CONTRIBUTING.md), [사용 설명서](docs/manual/INDEX.md), [아키텍처](docs/ARCHITECTURE.md), [Dashboard 가이드](docs/DASHBOARD.md), [IT Ops 가이드](docs/ITOPS.md), [Custom Module Host API](docs/KKMOD_HOST_API_V2.md)를 참고하세요.

KKTerm이 유용하다면 [Microsoft Store](https://apps.microsoft.com/detail/9nvqc5cnwwjk?hl=zh-TW&gl=HK)나 [Mac App Store](https://apps.apple.com/tw/app/kkterm/id6806710046?mt=12)에서 구매(일회성 결제, 구독 없음)해 주시는 것이 가장 큰 후원이 됩니다——[커피 한 잔 사주기](https://buymeacoffee.com/ryantsai)도 환영합니다.

## 라이선스

KKTerm 소스 코드는 MIT + Commons Clause를 따릅니다. Vendored crate, Custom Module, 글꼴, 아이콘 팩은 각각의 라이선스를 따르며 자세한 내용은 [`LICENSE`](LICENSE)와 각 디렉터리의 고지 파일을 확인하세요.
