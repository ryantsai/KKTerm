<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>ターミナル、SSH、SFTP、RDP/VNC、Dashboard を1つのWindowsネイティブウィンドウに——おまけに、頼めば自分専用の小さなツールを作ってくれるAI付き。</strong>
</p>

<p align="center">
  <em>タスクバーをラスベガスのスロットマシンにしなくていい。</em>
</p>

<p align="center">
  <sub>名前の由来は<strong>乖乖 (グァイグァイ / Kuāi Kuāi)</strong>——台湾のサーバー管理者がサーバーの上に置く、緑色のココナッツ味コーンスナック。このアプリもラックに置いてもらえる存在でありたい。</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">最新の KKTerm リリースをダウンロード</a></strong>
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
    <img src="https://img.shields.io/github/license/ryantsai/KKTerm?style=for-the-badge&color=blue" alt="MIT License" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="Cross-platform desktop" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="Local-first" />
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

## はじめに（45秒で読める）

KKTerm はローカルターミナル、SSH/SFTP、FTP/FTPS、Telnet、シリアル接続、RDP/VNC、埋め込み Web ページ、ローカルファイル、ドキュメントを一つのデスクトップワークスペースにまとめます。Tab には異なる種類の Pane を配置でき、同じ作業のターミナル、ファイルブラウザー、リモート画面を一緒に保てます。

Windows、macOS、Linux で動作し、データはローカルに保存され、テレメトリはありません。承認制の AI、カスタマイズ可能な Dashboard widget、Workspace、IT Ops、Windows 向け Install Helper も内蔵しています。

---

## なぜ「KKTerm」なのか

台湾のデータセンターに行って、ラックの上を見てみてほしい。TSMCの工場、台北メトロの制御室、国泰銀行のサーバーホール、中華電信の交換機——どこかに必ず小さな緑色の袋が置いてある。**乖乖 (グァイグァイ / Kuāi Kuāi)**、1960年代から続くココナッツ味のコーンスナックだ。

**KKTerm** は **Kuai Kuai Term**——あのスナックと同じ志を持つ管理ワークスペースだ：大事なマシンの隣に静かに座って、ちゃんと動くのを助ける。ローカルファースト。テレメトリーなし。AIは承認ゲート付き。退屈で頼れる類のソフトウェア。

実物の乖乖をインストーラーに同梱することは、まだ実現できていない。それは v2 の課題だ。

---

## 動いているところを見る

<p align="center">
  <a href="https://github.com/ryantsai/KKTerm">
    <img
      src="docs/assets/demo.gif"
      alt="KKTerm demo"
      width="720"
    />
  </a>
</p>

<p align="center"><sub><em>（デモGIF。一枚の絵は千の箇条書きに勝る。そして箇条書きはもう尽きかけている。）</em></sub></p>

---

## 1つのウィンドウ、あらゆる接続

| やりたかったこと | KKTerm ならこうなる |
| --- | --- |
| ローカルの PowerShell / cmd / WSL シェルを開く | ローカルターミナルを並べて表示 |
| サーバーへSSH | 鍵・agent・パスワード・踏み台ホスト・ポートフォワーディング対応のSSH |
| そのサーバーのファイルを見る | SSH接続からSFTPを起動——デュアルペイン、ドラッグで転送 |
| 2012年のNASへFTP | FTP / FTPS、同じファイルブラウザの中で |
| 骨董品の機器へTelnet | はい、Telnetも入っています |
| シリアルポートと会話 | Serial接続——COMポートとボーレートを選ぶだけ |
| Windowsマシンへリモート | 本物のMicrosoftリモートデスクトップを内蔵 |
| Piへ VNC | VNC、ワークスペースに直接描画 |
| ルーターのWeb UIを開く | ログイン情報を保存できる組み込みブラウザタブ |
| 自分のディスクを見る | ローカルのFile Explorer Pane、SFTPと同じデュアルペインの外殻 |
| ログ・CSV・画像・PDFを開く | 本物のtail追従ログモードを備えた組み込みDocumentビューア |
| ホストのCPUを見る | ライブのステータスバーと、自分で組み立てられるDashboard |

同じアプリ。同じウィンドウ。同じホットキー。同じ、できれば目に優しいテーマ。

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="1つのTabにSSH・SFTP・組み込みWeb UIを並べて表示" width="720" />
</p>

---

## なぜ一日中開きっぱなしになるのか

### 小さなダウンロード、稲妻のような起動

KKTerm はプラットフォームではなく、道具として感じられるように作っている。現在のデスクトップビルドは 20 MB 未満で、すぐインストールでき、管理ワークスペースを開くのに別のOSを起動しているような重さがない。

### マルチペインのグリッドで、接続を自由に混ぜる

1つの Tab には Pane のグリッドを置けるし、その Pane は同じ種類でなくていい。SSHの隣にSFTP、RDP Sessionの下にローカルPowerShell、VNCの横にルーターのWeb UI、ファイルを動かしているターミナルの横にファイルブラウザーを置ける。

<p align="center">
  <img src="docs/assets/screenshots/multi-pane.png" alt="1つのTabを4つの異なる接続種類のペインに分割" width="720" />
</p>

### あなたのターミナルを操作してくれるAIアシスタント

たいていの「ターミナルの中のAI」デモはチャットで止まる。KKTerm のアシスタントはあなたのセッションの*中で*動く：画面にすでにあるものをコンテキストとして渡せば、つないでいるマシンに対してアシスタントが手を動かす——しかも常に人間が承認ループにいる。

<p align="center">
  <img src="docs/assets/screenshots/ai-assistant.png" alt="ツールアクセスと承認モードのトグルを備えたAIアシスタントパネル" width="720" />
</p>

### Grafanaのふりをしないダッシュボード

Dashboard はドラッグ＆リサイズできるWidgetのグリッドだ。ペタバイト規模の可観測性のためのものではない——「お気に入りのアプリ5つを起動するボタンと、SSHホストの稼働時間を表示するパネルが、チャットの*隣に*ほしい」のためのものだ。

Dashboard View では、KKTerm 内蔵のアニメーション背景を45種類利用できます。新たに加わった8つのプロシージャル WebGL シーンは `heroGeometric`、`ditherPrismHero`、`webglLiquid`、`silkAurora`、`closingPlasma`、`animatedGradient`、`prismGradient`、`liquidChrome` です。同じ背景ピッカーは Terminal Connection、Document viewer、IT Ops の詳細ビューでも利用でき、非表示または画面外のシーンは描画を停止して WebGL リソースを解放します。

<p align="center">
  <img src="docs/assets/screenshots/ai-widgets.png" alt="AIが作ったWidgetが並ぶDashboardグリッド" width="720" />
</p>

### サイト、ホスト、反復作業のための IT Ops

**IT Ops** Module は Connection を Site にまとめ、Server Room と Rack を可視化し、Host を管理して、選択したマシンで再利用可能な Task を実行します。Batch Run は Host ごとの結果を保存し、Automation はトリガーと条件を通知、Webhook、Task につなげます。

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="6台の機器ラックとホストの稼働状況を表示する IT Ops のサーバールーム正面図" width="720" />
</p>

### スクリーンショットを撮影・整理・注釈

**Screenshots** Module では、選択範囲、ウィンドウ、デスクトップ全体をローカルライブラリ、クリップボード、またはその両方に取り込めます。画像の並べ替えやグループ化、一括リサイズ・形式変換に加え、内蔵エディターで切り抜き、手描き、矢印、図形、テキスト、モザイク処理ができます。グローバルショートカットとトレイメニューから、いつでもすぐに撮影できます。

<p align="center">
  <img src="docs/assets/screenshots/screenshots-module.png" alt="撮影コントロールとサムネイルライブラリを表示した Screenshots Module" width="720" />
</p>

### AIエージェントを生かし続ける

これがみんなが惚れ込む2つ目の機能だ。KKTerm のSSHターミナルは、再接続を生き延びるリモートホスト上の**名前付きtmuxセッション**に、あなたを直接放り込める。

<p align="center">
  <img src="docs/assets/screenshots/tmux-reattach.png" alt="再接続後に名前付きtmuxセッションへ再アタッチするSSH Pane" width="720" />
</p>

### ワークスペースで世界を分ける

ホームラボ、本業、あの客先のサーバーは、同じリストに入れるものではない。**ワークスペース (Workspaces)** は、Activity Rail から切り替える、名前付きで隔離された Connection のコンテナだ。切り替えても再スコープされるのは接続ツリーだけ——開いている Sessions、Dashboard、設定はそのまま——だからコンテキストの切り替えは、再起動ではなくワンクリックで済む。

<p align="center">
  <img src="docs/assets/screenshots/workspaces.png" alt="Activity Rail のワークスペース切り替え" width="720" />
</p>

### 好みの色に着せ替える：カラーテーマ

背景は遊びの部分。**カラーテーマ**は一日中実際に見つめ続ける部分だ。KKTerm はアプリ全体のクロム——Activity Rail、接続ツリー、タブ、ダイアログ——を着せ替える**26種類**のカラースキームを備えており、設定 ▸ 外観で各スキームのライブミニプレビューを表示する。

<p align="center">
  <img src="docs/assets/screenshots/color-themes.png" alt="設定のカラースキームグリッドとライブプレビュー" width="720" />
</p>

### Install Helper（Windows専用）

開発用に新品の Windows マシンをセットアップするのは、たいてい10個のブラウザータブと「次へ、次へ、完了」の繰り返しだ。**Install Helper** は内蔵のツールカタログで、普段なら手作業で追いかけるツールを、KKTerm から離れずに見つけ・インストールし・更新し・アンインストールする。

<p align="center">
  <img src="docs/assets/screenshots/install-helper.png" alt="インストール済みと利用可能なツールを含む Install Helper カタログ" width="720" />
</p>

---

## KKTerm でないもの

短いリスト。正直さが信頼を生むからだ：

- **クラウド製品ではない。** 同期なし、チームアカウントなし、SaaSプランなし。もし「KKTerm にサインイン」ダイアログを見たら、何かが壊滅的に間違っている。
- **すべてのOSが同じだとは装わない。** KKTerm は Windows、macOS、Linux のビルドを出荷するが、プラットフォーム固有の機能は正直に分けている：Windows にはネイティブ RDP ActiveX パスと Install Helper カタログがあり、macOS と Linux ではそれぞれのシステムで使えるポータブルな経路を使う。
- **自律型AIエージェントではない。** アシスタントは提案し、人間が決める。`Allow All` は既定ではなく、あなたが下す選択だ。
- **Grafana / Datadog の代替ではない。** Dashboard は個人のコントロール面のためのもので、1万台規模の可観測性のためではない。
- **Kubernetes IDE ではない。** これはターミナル中心の管理ワークスペースだ。Helmチャートを描けと頼まないでほしい。

そのどれかが*もし*決定的な問題だったなら——わかった、v2で会おう。

---

## KKTerm を入手する

**[最新の KKTerm リリースをダウンロード](https://github.com/ryantsai/KKTerm/releases/latest)** し、自分のプラットフォーム向けのパッケージを選んで開く。Windows インストーラーは現在**未署名**だ——リリース署名はロードマップにあるので、それまではウイルス対策ソフトに厳しい目で見られるかもしれない。正常だ。

ソースからビルドしたい、または貢献したい？必要なものはすべて [`CONTRIBUTING.md`](CONTRIBUTING.md) にある。

---

## ロードマップ（短縮版）

- クロスプラットフォームリリースの磨き込み
- リリース署名の磨き込み
- より強力なファイル転送（再開、フォルダ同期、圧縮/展開）
- より充実したリモートデスクトップのクリップボード・デバイス共有
- 組み込みDashboard Widget の追加
- IT Ops 自動化機能の追加

完全で頻繁に更新される版：[`docs/ROADMAP.md`](docs/ROADMAP.md)。

---

## 貢献

手を貸してくれたら嬉しい。本気だ。小さなことでも大事だ。

セットアップ一式、プロジェクト構成、PRチェックリストは [`CONTRIBUTING.md`](CONTRIBUTING.md) にある。入口を探している？open issueを [`good first issue`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) や [`help wanted`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) で絞り込んでみてほしい。

---

## プロジェクトドキュメント

- [プロダクトコンテキスト](CONTEXT.md) — 合わせるべきドメイン言語
- [アーキテクチャ](docs/ARCHITECTURE.md) — モジュールマップ、新しいコードの置き場所
- [ユーザーマニュアル](docs/manual/INDEX.md) — 機能ごとの解説
- [ロードマップ](docs/ROADMAP.md)
- [Dashboard アーキテクチャ](docs/DASHBOARD.md)
- [組み込みMCPサーバー](docs/MCP.md)
- [AIプロバイダーガイド](docs/AI_PROVIDERS.md)

---

## ライセンス

MIT。[LICENSE](LICENSE) を参照。使って、フォークして、出荷して、誰にも見つからないホームラボに入れて——それがこの取引だ。
