<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>ターミナル、SSH/SFTP、RDP/VNC、ファイル、Web、IT Ops、承認制AIアシスタントを1つにまとめるクロスプラットフォームのデスクトップワークスペース。</strong>
</p>

<p align="center">
  <em>タスクバーをラスベガスのスロットマシンにしなくていい。</em>
</p>

<p align="center">
  <sub>名前の由来は<strong>乖乖 (Kuāi Kuāi)</strong>——台湾のシステム管理者がサーバーの上に置く、緑色のココナッツ味コーンスナックです。</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">最新の KKTerm をダウンロード</a></strong>
</p>

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
    <img src="https://img.shields.io/badge/Buy_Me_a_Coffee-%E2%98%95-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="コーヒーをごちそうする" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="クロスプラットフォームデスクトップ" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="ローカルファースト、テレメトリーなし" />
  <br />
  <sub>
    <a href="README.md">English</a> ·
    <a href="README.zh-TW.md">繁體中文</a> ·
    <a href="README.zh-CN.md">简体中文</a> ·
    <strong>日本語</strong> ·
    <a href="README.ko.md">한국어</a> ·
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

## なぜ「KKTerm」なのか

KKTerm は **Kuai Kuai Term**。台湾のシステム管理者がサーバーに置く緑色の乖乖にちなみ、大切なマシンが静かに、確実に、行儀よく動くことを願う名前です。

## 1つのウィンドウ、すべての接続

KKTerm はローカルシェル、SSH/SFTP、FTP/FTPS、Telnet、シリアル、RDP/VNC、URL 接続、ローカルファイルブラウザー、ドキュメントビューアーを1つのデスクトップワークスペースにまとめます。Tab には異なる種類の Pane を混在させられるため、同じ作業のターミナル、ファイル、Web UI、リモート画面を一緒に置けます。

| 用途 | KKTerm |
| --- | --- |
| ローカルシェル | PowerShell、cmd、WSL |
| リモートアクセス | SSH、Telnet、シリアル、RDP、VNC |
| ファイルと Web | SFTP、FTP/FTPS、ローカルファイル、埋め込み URL 接続 |
| ドキュメント | tail-follow 対応ログ、テキスト、CSV、画像、PDF |

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="1つの KKTerm Tab に SSH、SFTP、ターミナル、URL、RDP の Pane を混在させた画面" width="720" />
</p>

## ターミナルの周りの仕事もまとめて

- **Workspace** — Tab と Pane の混在、名前付き Workspace、tmux の再アタッチ、Connection Notes、Git Browser、File Compare。
- **AI Assistant** — Session、Dashboard、IT Ops、Custom Module を操作する承認制ツール。添付ファイル、ターミナルへの送信、MCP、再利用可能な Assistant Skills にも対応します。
- **Dashboard** — 切り替え可能な View と、ドラッグ・サイズ変更できる内蔵／AI 作成 Widget。App Launcher、ライブ Connection パネル、Notes、使用量メーター、各種ユーティリティを備えます。
- **IT Ops** — Site の Server Room と Rack トポロジー（elevation、floor plan、2.5D View）、Host インベントリと接続スキャン、再利用可能な Script/Playbook Task、SSH/WinRM/PsExec の Batch Run、IPAM、VLAN、Network Map、実行履歴、PDF/CSV エクスポート。
- **Screenshots** — 範囲、ウィンドウ、デスクトップ全体をキャプチャし、ローカルライブラリやクリップボードへ保存。サイズ変更・変換の一括処理と、切り抜き、図形、テキスト、モザイク注釈に対応します。
- **Custom Modules** — Settings から隔離された `.kkmod` パッケージをインストールし、宣言された権限を確認して Activity Rail に追加できます。更新、ロールバック、ストレージ、アンインストールも管理できます。リポジトリには Excalidraw、BentoPDF、OpenFlowKit、TiddlyWiki などの統合が含まれます。
- **Install Helper（Windows）** — KKTerm を離れずに、ツールや対応するローカル Web アプリ／サービスの検索、インストール、更新、アンインストールを行えます。

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="KKTerm IT Ops の Server Room Rack elevation とデバイスの状態表示" width="720" />
</p>

## 自分好みに仕上げる

Dashboard View、ターミナル Connection、ドキュメントビューアー、IT Ops のドリルビューは同じ背景ピッカーを使います。単色・グラデーションのプリセット、ローカルの画像・動画、または **84 種類の内蔵ダイナミック背景**から選択できます。海や天候、WebGL シーン、宇宙、ネットワークグラフィック、抽象的なモーションまで揃っています。非表示または画面外のシーンは一時停止し、描画リソースを解放します。カラーテーマ、ターミナル外観、カスタムフォント、Connection ごとの背景も設定できます。

<p align="center">
  <img src="docs/assets/screenshots/backgrounds.png" alt="KKTerm のダイナミック背景ピッカー" width="720" />
</p>

## 実際に見る

<p align="center">
  <img src="docs/assets/demo.gif" alt="KKTerm のデモ" width="720" />
</p>

## KKTerm を入手する

[最新リリース](https://github.com/ryantsai/KKTerm/releases/latest)から Windows、macOS、Linux 用のバージョンをダウンロードしてください。Windows にはセットアップ実行ファイルと x64/ARM64 のポータブル ZIP があります。ポータブル ZIP は書き込み可能なローカルフォルダーまたはリムーバブルドライブに展開し、ネットワーク共有から実行しないでください。実行前に隣接する `.sha256` ファイルを確認してください。

ソースからビルドする場合は、まず [`CONTRIBUTING.md`](CONTRIBUTING.md) をお読みください。

## 貢献、支援、ドキュメント

コントリビューションと不具合報告を歓迎します。 [`CONTRIBUTING.md`](CONTRIBUTING.md)、[操作マニュアル](docs/manual/INDEX.md)、[アーキテクチャ](docs/ARCHITECTURE.md)、[Dashboard ガイド](docs/DASHBOARD.md)、[IT Ops ガイド](docs/ITOPS.md)、[Custom Module Host API](docs/KKMOD_HOST_API_V2.md) を参照してください。

KKTerm が役に立ったら、[コーヒーをごちそういただけます](https://buymeacoffee.com/ryantsai)。

## ライセンス

KKTerm のソースコードは MIT + Commons Clause です。Vendored crate、Custom Module、フォント、アイコンパックはそれぞれのライセンスに従います。詳細は [`LICENSE`](LICENSE) と各ディレクトリの通知ファイルをご覧ください。
