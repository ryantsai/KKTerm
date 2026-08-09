<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>Satu jendela Windows native untuk terminal, SSH, SFTP, RDP/VNC, dan dashboard — plus AI yang membuatkan alat-alat kecilmu sendiri sesuai permintaan.</strong>
</p>

<p align="center">
  <em>Karena taskbar-mu tidak seharusnya terlihat seperti mesin slot Las Vegas.</em>
</p>

<p align="center">
  <sub>Dinamai dari <strong>乖乖 (Kuāi Kuāi)</strong>, camilan jagung hijau rasa kelapa yang ditaruh para sysadmin Taiwan di atas server agar berperilaku baik. Semoga aplikasi ini juga mendapat tempatnya di rak.</sub>
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
    <img src="https://img.shields.io/github/license/ryantsai/KKTerm?style=for-the-badge&color=blue" alt="MIT License" />
  </a>
  <a href="https://github.com/sponsors/ryantsai">
    <img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Dukung KKTerm di GitHub" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="Cross-platform desktop" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="Local-first" />
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

## Pitch dalam 45 detik

KKTerm menyatukan terminal lokal, SSH/SFTP, FTP/FTPS, Telnet, serial, RDP/VNC, halaman web tertanam, berkas lokal, dan dokumen dalam satu workspace desktop. Tab dapat mencampur berbagai jenis Pane agar terminal, penjelajah berkas, dan layar jarak jauh untuk satu pekerjaan tetap berdampingan.

KKTerm berjalan di Windows, macOS, dan Linux dengan penyimpanan lokal serta tanpa telemetri. AI dengan persetujuan pengguna, widget Dashboard yang dapat disesuaikan, Workspace, IT Ops, dan Install Helper untuk Windows sudah tersedia.

---

## Kenapa "KKTerm"?

Masuklah ke data center Taiwan mana pun dan lihat bagian atas rak. Melewati pabrik TSMC, ruang kendali Metro Taipei, ruang server bank Cathay, perangkat switching Chunghwa Telecom — kamu akan melihat kantong hijau kecil 乖乖 (Kuāi Kuāi), camilan jagung rasa kelapa dari era 1960-an.

**KKTerm** adalah **Kuai Kuai Term** — ruang kerja admin yang mengincar pekerjaan yang sama dengan camilan itu: duduk diam di samping mesin-mesin pentingmu dan membantu mereka berperilaku baik. Local-first. Tanpa telemetri. AI dengan persetujuan. Jenis perangkat lunak yang membosankan tapi bisa diandalkan.

Kami belum berhasil menyertakan sekantong Kuai Kuai sungguhan bersama installer-nya. Itu item untuk v2.

---

## Lihat ia bergerak

<p align="center">
  <a href="https://github.com/ryantsai/KKTerm">
    <img
      src="docs/assets/demo.gif"
      alt="KKTerm demo"
      width="720"
    />
  </a>
</p>

<p align="center"><sub><em>(GIF demo. Satu gambar bernilai seribu poin, dan poin kami sudah habis.)</em></sub></p>

---

## Satu jendela, setiap koneksi

| Kamu ingin… | KKTerm melakukannya |
| --- | --- |
| Buka shell lokal PowerShell / cmd / WSL | Terminal lokal, berdampingan |
| SSH ke server | SSH dengan kunci, agent, kata sandi, jump host, dan port forwarding |
| Jelajahi berkas di server itu | SFTP dari koneksi SSH — panel ganda, seret untuk transfer |
| FTP ke NAS dari 2012 | FTP / FTPS di browser berkas yang sama |
| Telnet ke perangkat purba | Ya, Telnet juga ada di dalamnya |
| Bicara dengan port serial | Koneksi serial — pilih port COM dan baud |
| Remote ke mesin Windows | Remote Desktop Microsoft asli, terintegrasi langsung |
| VNC ke sebuah Pi | VNC, dirender langsung ke ruang kerja |
| Buka UI web router | Tab browser tertanam dengan login tersimpan |
| Jelajahi disk-mu sendiri | Panel File Explorer lokal, cangkang panel ganda yang sama dengan SFTP |
| Buka log, CSV, gambar, atau PDF | Penampil Document bawaan dengan mode log tail-follow sungguhan |
| Pantau CPU host | Bilah status langsung dan dashboard yang kamu rakit sendiri |

Aplikasi yang sama. Jendela yang sama. Pintasan yang sama. Tema yang sama, yang semoga tak bikin matamu berdarah.

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="Satu Tab berisi SSH, SFTP, dan UI web tertanam berdampingan" width="720" />
</p>

---

## Kenapa orang membiarkannya terbuka seharian

### Unduhan kecil, peluncuran secepat kilat

KKTerm dibuat agar terasa seperti utilitas, bukan platform. Build desktop saat ini di bawah 20 MB, cepat dipasang, dan meluncur cukup cepat sehingga membuka workspace admin-mu tidak terasa seperti menyalakan sistem operasi kedua.

### Grid multi-Pane, campur sesuai cara kerjamu

Sebuah Tab bisa berisi grid Panes, dan Panes itu tidak harus sejenis. Taruh SSH di sebelah SFTP, PowerShell lokal di bawah RDP Session, VNC di sebelah UI web router, atau file browser di samping terminal yang sedang memindahkan file.

<p align="center">
  <img src="docs/assets/screenshots/multi-pane.png" alt="Sebuah Tab terbagi menjadi empat panel dengan jenis koneksi berbeda" width="720" />
</p>

### Asisten AI yang mengomandoi terminalmu untukmu

Kebanyakan demo "AI di terminalmu" berhenti di obrolan. Asisten KKTerm bekerja *di dalam* sesimu: kamu menyerahkan konteks dari apa yang sudah ada di layar, dan ia bertindak pada mesin-mesin yang sedang kamu sambungkan — dengan manusia di dalam lingkar persetujuan.

<p align="center">
  <img src="docs/assets/screenshots/ai-assistant.png" alt="Panel asisten AI dengan sakelar akses alat dan mode persetujuan" width="720" />
</p>

### Dashboard yang tidak berpura-pura jadi Grafana

Dashboard adalah grid widget yang bisa kamu seret dan ubah ukurannya. Ini bukan untuk observability skala petabyte — ini untuk "aku mau satu tombol untuk meluncurkan lima aplikasi favoritku dan satu panel yang menampilkan uptime host SSH-ku, *di samping* obrolanku".

Dashboard View menyediakan 45 latar animasi bawaan KKTerm. Delapan yang terbaru adalah adegan WebGL prosedural: `heroGeometric`, `ditherPrismHero`, `webglLiquid`, `silkAurora`, `closingPlasma`, `animatedGradient`, `prismGradient`, dan `liquidChrome`. Pemilih latar yang sama juga tersedia untuk Terminal Connection, Document viewer, dan tampilan mendalam IT Ops; adegan yang disembunyikan atau berada di luar layar akan berhenti dirender dan melepaskan sumber daya WebGL.

<p align="center">
  <img src="docs/assets/screenshots/ai-widgets.png" alt="Grid dashboard penuh widget buatan AI" width="720" />
</p>

### IT Ops untuk Site, Host, dan pekerjaan berulang

Module **IT Ops** mengelompokkan Connection ke dalam Site, memetakan Server Room dan Rack, menginventarisasi Host, serta menjalankan Task yang dapat digunakan kembali pada mesin terpilih. Batch Run menyimpan hasil per Host, sedangkan Automation mengubah pemicu dan kondisi menjadi notifikasi, webhook, atau Task.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="Tampilan elevasi Server Room IT Ops dengan enam Rack berisi perangkat dan indikator status Host" width="720" />
</p>

### Ambil, tata, dan anotasi tangkapan layar

Module **Screenshots** menangkap area, jendela, atau seluruh desktop ke pustaka lokal, clipboard, atau keduanya. Urutkan dan kelompokkan hasil tangkapan, ubah ukuran atau format beberapa gambar sekaligus, lalu buka gambar apa pun di editor bawaan untuk memotong, menggambar bebas, menambahkan panah, bentuk, dan teks, atau menyamarkan informasi dengan mosaik. Pintasan global dan menu baki sistem membuat pengambilan gambar selalu dapat dilakukan dalam satu kombinasi tombol.

<p align="center">
  <img src="docs/assets/screenshots/screenshots-module.png" alt="Module Screenshots dengan kontrol pengambilan dan pustaka gambar mini" width="720" />
</p>

### Jaga agar agen AI-mu tetap hidup

Ini fitur kedua yang membuat orang jatuh cinta. Terminal SSH KKTerm bisa langsung menjatuhkanmu ke sebuah **sesi tmux bernama** di host remote yang selamat dari penyambungan ulang.

<p align="center">
  <img src="docs/assets/screenshots/tmux-reattach.png" alt="Sebuah panel SSH menyambung kembali ke sesi tmux bernama setelah reconnect" width="720" />
</p>

### Pisahkan dunia-duniamu dengan Workspaces

Homelab, pekerjaan kantor, dan server klien itu tidak pantas berada di daftar yang sama. **Workspaces** adalah wadah Connections bernama dan terisolasi yang kamu tukar dari Activity Rail. Menukar hanya menata ulang cakupan pohon koneksi — Sessions yang terbuka, Dashboard, dan Pengaturanmu tetap di tempat — jadi berganti konteks cukup satu klik, bukan restart.

<p align="center">
  <img src="docs/assets/screenshots/workspaces.png" alt="Pengalih workspace di activity rail" width="720" />
</p>

### Dandani sesukamu: tema warna

Latar adalah bagian serunya; **tema warna** adalah yang benar-benar kamu pandangi seharian. KKTerm membawa **dua puluh enam** skema warna yang mendandani ulang seluruh chrome aplikasi — Activity Rail, pohon koneksi, tab, dialog — dengan pratinjau mini langsung untuk masing-masing di Pengaturan ▸ Tampilan.

<p align="center">
  <img src="docs/assets/screenshots/color-themes.png" alt="Grid skema warna di Pengaturan dengan pratinjau langsung" width="720" />
</p>

### Install Helper (khusus Windows)

Menyiapkan mesin Windows baru untuk kerja dev biasanya berarti sepuluh tab browser dan banyak "berikutnya, berikutnya, selesai". **Install Helper** adalah katalog bawaan yang menemukan, memasang, memperbarui, dan mencopot alat yang kalau tidak harus kamu kejar manual — tanpa keluar dari KKTerm.

<p align="center">
  <img src="docs/assets/screenshots/install-helper.png" alt="Katalog Install Helper dengan alat yang terpasang dan tersedia" width="720" />
</p>

---

## Apa yang bukan KKTerm

Daftar singkat, karena kejujuran menumbuhkan kepercayaan:

- **Bukan produk cloud.** Tanpa sinkronisasi, tanpa akun tim, tanpa tingkatan SaaS. Kalau suatu hari kamu melihat dialog "Masuk ke KKTerm", ada yang salah secara katastrofik.
- **Tidak berpura-pura semua OS identik.** KKTerm merilis build Windows, macOS, dan Linux, tetapi fitur khusus platform tetap diberi batas yang jujur dan jelas.
- **Bukan agen AI otonom.** Asisten mengusulkan; manusia memutuskan. `Allow All` adalah pilihan yang kamu buat, bukan default.
- **Bukan pengganti Grafana / Datadog.** Dashboard untuk permukaan kendali pribadi, bukan observability 10.000 host.
- **Bukan IDE Kubernetes.** Ini ruang kerja admin yang berpusat pada terminal. Tolong jangan minta ia me-render chart Helm.

Kalau salah satu poin itu *dulunya* jadi penentu — wajar saja, sampai jumpa di v2.

---

## Dapatkan KKTerm

**[Unduh rilis KKTerm terbaru](https://github.com/ryantsai/KKTerm/releases/latest)**, pilih paket untuk platformmu, lalu buka. Installer Windows saat ini **belum ditandatangani** — penandatanganan rilis ada di roadmap, jadi sampai saat itu antivirus-mu mungkin menatapmu tajam. Itu normal.

Mau build dari sumber atau berkontribusi? Semua yang kamu butuhkan ada di [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Roadmap (versi singkat)

- Pemolesan rilis lintas platform
- Pemolesan penandatanganan rilis
- Transfer berkas lebih bertenaga (lanjutkan, sinkron folder, arsip/ekstrak)
- Berbagi clipboard dan perangkat Remote Desktop yang lebih kaya
- Lebih banyak widget dashboard bawaan
- Lebih banyak fungsi otomatisasi IT Ops

Versi lengkap dan sering diperbarui: [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Dukungan

KKTerm dikembangkan dan dipelihara oleh satu orang. Jika bermanfaat bagimu, dukungan apa pun sangat berarti dan membantu saya terus mengembangkannya.

[![Dukung KKTerm di GitHub](https://img.shields.io/badge/Sponsor%20on%20GitHub-%E2%9D%A4-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/ryantsai)

---

## Berkontribusi

Kami akan senang sekali dibantu. Sungguh. Hal kecil pun penting.

Penyiapan lengkap, struktur proyek, dan checklist PR ada di [`CONTRIBUTING.md`](CONTRIBUTING.md). Mencari titik masuk? Saring issue terbuka dengan [`good first issue`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) atau [`help wanted`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22).

---

## Dokumen proyek

- [Konteks produk](CONTEXT.md) — bahasa domain yang harus kamu ikuti
- [Arsitektur](docs/ARCHITECTURE.md) — peta modul, di mana menaruh kode baru
- [Manual pengguna](docs/manual/INDEX.md) — keliling fitur demi fitur
- [Roadmap](docs/ROADMAP.md)
- [Arsitektur Dashboard](docs/DASHBOARD.md)
- [Server MCP bawaan](docs/MCP.md)
- [Panduan penyedia AI](docs/AI_PROVIDERS.md)

---

## Lisensi

MIT. Lihat [LICENSE](LICENSE). Pakai, fork, rilis, taruh di homelab yang takkan ditemukan orang lain — itulah kesepakatannya.
