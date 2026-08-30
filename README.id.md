<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>Ruang kerja desktop lintas platform untuk terminal, SSH/SFTP, RDP/VNC, file, web, IT Ops, dan asisten AI yang memerlukan persetujuan.</strong>
</p>

<p align="center">
  <em>Karena taskbar Anda tidak seharusnya terlihat seperti mesin slot Las Vegas.</em>
</p>

<p align="center">
  <sub>Namanya berasal dari <strong>乖乖 (Kuāi Kuāi)</strong>, camilan kelapa hijau yang diletakkan admin sistem Taiwan di atas server agar server bekerja dengan baik.</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">Unduh rilis KKTerm terbaru</a></strong>
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
    <img src="https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-blue?style=for-the-badge" alt="Lisensi MIT dengan Commons Clause" />
  </a>
  <a href="https://buymeacoffee.com/ryantsai">
    <img src="https://img.shields.io/badge/Buy_Me_a_Coffee-%E2%98%95-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Traktir saya kopi" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="Desktop lintas platform" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="Local-first, tanpa telemetri" />
  <br />
  <sub>
    <a href="README.md">English</a> ·
    <a href="README.zh-TW.md">繁體中文</a> ·
    <a href="README.zh-CN.md">简体中文</a> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="README.ko.md">한국어</a> ·
    <a href="README.fr.md">Français</a> ·
    <a href="README.de.md">Deutsch</a> ·
    <a href="README.es.md">Español</a> ·
    <a href="README.es-MX.md">Español (MX)</a> ·
    <a href="README.it.md">Italiano</a> ·
    <a href="README.pt-BR.md">Português (BR)</a> ·
    <a href="README.th.md">ไทย</a> ·
    <strong>Bahasa Indonesia</strong> ·
    <a href="README.vi.md">Tiếng Việt</a>
  </sub>
</p>

---

## Kenapa "KKTerm"?

KKTerm berarti **Kuai Kuai Term** — merujuk pada 乖乖 hijau yang diletakkan admin sistem Taiwan di atas server agar mesin penting tetap tenang, andal, dan bekerja dengan baik.

## Satu jendela, semua koneksi

KKTerm menggabungkan shell lokal, SSH/SFTP, FTP/FTPS, Telnet, koneksi serial, RDP/VNC, koneksi URL, File Explorer lokal, dan penampil dokumen dalam satu ruang kerja desktop. Satu Tab dapat mencampur berbagai jenis Pane, sehingga terminal, browser file, UI web, dan layar jarak jauh untuk satu pekerjaan tetap bersama.

| Kebutuhan | KKTerm |
| --- | --- |
| Shell lokal | PowerShell, cmd, dan WSL |
| Akses jarak jauh | SSH, Telnet, serial, RDP, dan VNC |
| File dan web | SFTP, FTP/FTPS, file lokal, dan koneksi URL tertanam |
| Dokumen | Log dengan tail-follow, teks, CSV, gambar, dan PDF |

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="Pane SSH, SFTP, terminal, URL, dan RDP dalam satu Tab KKTerm" width="720" />
</p>

## Semua pekerjaan di sekitar terminal

- **Workspace** — Tab dan Pane campuran, Workspace bernama, tmux reattach, Connection Notes, Git Browser, dan File Compare.
- **AI Assistant** — alat yang memerlukan persetujuan untuk Session, Dashboard, IT Ops, dan Custom Modules, serta lampiran, pengiriman ke terminal, MCP, dan Assistant Skills yang dapat digunakan kembali.
- **Dashboard** — View yang dapat diganti dengan Widget bawaan atau buatan AI yang dapat dipindahkan dan diubah ukurannya. Termasuk App Launcher, panel Connection langsung, Notes, meter penggunaan, dan berbagai utilitas.
- **IT Ops** — topologi Site → Server Room → Rack (elevation, floor plan, dan tampilan 2.5D), inventaris Host dan pemindaian konektivitas, Task Script/Playbook yang dapat digunakan kembali, Batch Run melalui SSH/WinRM/PsExec, IPAM, VLAN, Network Map, riwayat eksekusi, dan ekspor PDF/CSV.
- **Screenshots** — tangkap area, jendela, atau seluruh desktop; simpan ke pustaka lokal atau clipboard; ubah ukuran/format secara batch; dan beri anotasi dengan potong, bentuk, teks, dan mosaik.
- **Custom Modules** — instal paket `.kkmod` terisolasi dari Settings, tinjau izin yang dideklarasikan, tambahkan tujuan ke Activity Rail, dan kelola pembaruan, rollback, penyimpanan, serta uninstall. Repositori ini menyertakan integrasi seperti Excalidraw, BentoPDF, OpenFlowKit, dan TiddlyWiki.
- **Install Helper (Windows)** — cari, instal, perbarui, dan uninstall alat, aplikasi web lokal, serta layanan yang didukung tanpa meninggalkan KKTerm.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="Rack elevation IT Ops dengan indikator status perangkat" width="720" />
</p>

## Sesuaikan dengan gaya Anda

Dashboard View, Connection terminal, penampil dokumen, dan drill view IT Ops memakai pemilih latar belakang yang sama. Pilih warna dan gradien, gambar dan video lokal, atau **84 latar belakang dinamis bawaan** dengan tema laut, cuaca, adegan WebGL, ruang angkasa, grafik jaringan, dan gerakan abstrak. Adegan yang tersembunyi atau berada di luar layar dijeda dan melepaskan sumber daya render. Tema warna, tampilan terminal, font kustom, dan latar belakang per Connection melengkapi penyesuaian.

<p align="center">
  <img src="docs/assets/screenshots/backgrounds.png" alt="Pemilih latar belakang dinamis KKTerm" width="720" />
</p>

## Lihat aksinya

<p align="center">
  <img src="docs/assets/demo.gif" alt="Demo KKTerm" width="720" />
</p>

## Dapatkan KKTerm

Unduh [rilis terbaru](https://github.com/ryantsai/KKTerm/releases/latest) untuk Windows, macOS, atau Linux. Windows menyediakan installer dan ZIP portabel x64/ARM64; ekstrak ZIP portabel ke folder lokal yang dapat ditulis atau drive yang dapat dilepas, bukan ke lokasi berbagi jaringan. Verifikasi file `.sha256` di sebelahnya sebelum menjalankan paket.

Untuk build dari source, mulai dengan [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Berkontribusi, mendukung, dan dokumentasi

Kontribusi dan laporan bug diterima. Lihat [`CONTRIBUTING.md`](CONTRIBUTING.md), [manual operasi](docs/manual/INDEX.md), [arsitektur](docs/ARCHITECTURE.md), [panduan Dashboard](docs/DASHBOARD.md), [panduan IT Ops](docs/ITOPS.md), dan [Custom Module Host API](docs/KKMOD_HOST_API_V2.md).

Jika KKTerm bermanfaat, Anda dapat [mentraktir saya kopi](https://buymeacoffee.com/ryantsai).

## Lisensi

Source KKTerm menggunakan MIT dengan Commons Clause. Crate vendored, Custom Modules, font, dan paket ikon tetap mengikuti lisensinya masing-masing; lihat [`LICENSE`](LICENSE) dan pemberitahuan di direktorinya.
