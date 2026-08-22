<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>Không gian làm việc desktop đa nền tảng cho terminal, SSH/SFTP, RDP/VNC, tệp, web, IT Ops và trợ lý AI có bước phê duyệt.</strong>
</p>

<p align="center">
  <em>Vì thanh tác vụ của bạn không nên trông như một máy đánh bạc ở Las Vegas.</em>
</p>

<p align="center">
  <sub>Tên gọi bắt nguồn từ <strong>乖乖 (Kuāi Kuāi)</strong>, món bánh ngô vị dừa màu xanh mà quản trị viên hệ thống Đài Loan đặt trên máy chủ để chúng hoạt động ngoan ngoãn.</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">Tải bản KKTerm mới nhất</a></strong>
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
    <img src="https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-blue?style=for-the-badge" alt="Giấy phép MIT kèm Commons Clause" />
  </a>
  <a href="https://github.com/sponsors/ryantsai">
    <img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Ủng hộ KKTerm trên GitHub" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="Desktop đa nền tảng" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="Ưu tiên cục bộ, không telemetry" />
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
    <a href="README.id.md">Bahasa Indonesia</a> ·
    <strong>Tiếng Việt</strong>
  </sub>
</p>

---

## Vì sao là "KKTerm"?

KKTerm là viết tắt của **Kuai Kuai Term**, lấy cảm hứng từ gói 乖乖 màu xanh mà quản trị viên hệ thống Đài Loan đặt trên máy chủ để những máy quan trọng luôn hoạt động yên ổn, đáng tin cậy và ngoan ngoãn.

## Một cửa sổ, mọi kết nối

KKTerm đưa shell cục bộ, SSH/SFTP, FTP/FTPS, Telnet, kết nối serial, RDP/VNC, kết nối URL, File Explorer cục bộ và trình xem tài liệu vào cùng một không gian làm việc desktop. Một Tab có thể trộn nhiều loại Pane, để terminal, trình duyệt tệp, giao diện web và màn hình từ xa của cùng một công việc ở cạnh nhau.

| Nhu cầu | KKTerm |
| --- | --- |
| Shell cục bộ | PowerShell, cmd và WSL |
| Truy cập từ xa | SSH, Telnet, serial, RDP và VNC |
| Tệp và web | SFTP, FTP/FTPS, tệp cục bộ và kết nối URL nhúng |
| Tài liệu | log theo dõi liên tục, văn bản, CSV, hình ảnh và PDF |

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="Các Pane SSH, SFTP, terminal, URL và RDP trong một Tab KKTerm" width="720" />
</p>

## Cho cả những việc quanh terminal

- **Workspace** — trộn Tab và Pane, Workspace có tên, tmux reattach, Connection Notes, Git Browser và File Compare.
- **Trợ lý AI** — công cụ có phê duyệt cho Session, Dashboard, IT Ops và Custom Modules, cùng tệp đính kèm, gửi lệnh vào terminal, MCP và Assistant Skills có thể tái sử dụng.
- **Dashboard** — các View có thể chuyển đổi với Widget tích hợp hoặc do AI tạo, có thể kéo và đổi kích thước. Bao gồm App Launcher, bảng Connection trực tiếp, Notes, đồng hồ đo mức sử dụng và các công cụ tiện ích.
- **IT Ops** — topology Site → Server Room → Rack (elevation, floor plan và chế độ xem 2.5D), inventory Host và quét kết nối, Task Script/Playbook có thể dùng lại, Batch Run qua SSH/WinRM/PsExec, IPAM, VLAN, Network Map, lịch sử chạy và xuất PDF/CSV.
- **Screenshots** — chụp vùng, cửa sổ hoặc toàn bộ desktop; lưu vào thư viện cục bộ hoặc clipboard; đổi kích thước/chuyển đổi theo lô; và chú thích bằng cắt, hình dạng, văn bản và mosaic.
- **Custom Modules** — cài các gói `.kkmod` cô lập từ Settings, xem quyền đã khai báo, thêm đích vào Activity Rail và quản lý cập nhật, rollback, lưu trữ và gỡ cài đặt. Kho mã nguồn có các tích hợp như Excalidraw, BentoPDF, OpenFlowKit và TiddlyWiki.
- **Install Helper (Windows)** — tìm, cài đặt, cập nhật và gỡ cài đặt công cụ, ứng dụng web cục bộ và dịch vụ được hỗ trợ mà không cần rời KKTerm.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="Rack elevation của IT Ops với chỉ báo trạng thái thiết bị" width="720" />
</p>

## Tùy biến theo cách của bạn

Dashboard View, Connection của terminal, trình xem tài liệu và drill view của IT Ops dùng chung một bộ chọn nền. Chọn màu và gradient, hình ảnh và video cục bộ, hoặc **84 nền động tích hợp** với chủ đề đại dương, thời tiết, cảnh WebGL, không gian, đồ họa mạng và chuyển động trừu tượng. Các cảnh bị ẩn hoặc nằm ngoài màn hình sẽ tạm dừng và giải phóng tài nguyên kết xuất. Theme màu, giao diện terminal, font tùy chỉnh và nền theo từng Connection giúp hoàn thiện không gian làm việc.

<p align="center">
  <img src="docs/assets/screenshots/backgrounds.png" alt="Bộ chọn nền động của KKTerm" width="720" />
</p>

## Xem KKTerm hoạt động

<p align="center">
  <img src="docs/assets/demo.gif" alt="Bản demo KKTerm" width="720" />
</p>

## Tải KKTerm

Tải [bản phát hành mới nhất](https://github.com/ryantsai/KKTerm/releases/latest) cho Windows, macOS hoặc Linux. Windows có trình cài đặt và ZIP portable x64/ARM64; giải nén ZIP portable vào thư mục cục bộ có quyền ghi hoặc ổ đĩa rời, không chạy từ thư mục chia sẻ mạng. Hãy kiểm tra tệp `.sha256` đi kèm trước khi chạy gói cài đặt.

Nếu muốn build từ mã nguồn, hãy bắt đầu với [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Đóng góp, ủng hộ và tài liệu

Hoan nghênh đóng góp và báo lỗi. Xem [`CONTRIBUTING.md`](CONTRIBUTING.md), [sổ tay vận hành](docs/manual/INDEX.md), [kiến trúc](docs/ARCHITECTURE.md), [hướng dẫn Dashboard](docs/DASHBOARD.md), [hướng dẫn IT Ops](docs/ITOPS.md) và [Custom Module Host API](docs/KKMOD_HOST_API_V2.md).

Nếu KKTerm hữu ích, bạn có thể [ủng hộ dự án](https://github.com/sponsors/ryantsai).

## Giấy phép

Mã nguồn KKTerm dùng MIT kèm Commons Clause. Crate vendored, Custom Modules, font và gói biểu tượng vẫn tuân theo giấy phép riêng; xem [`LICENSE`](LICENSE) và các tệp thông báo trong từng thư mục.
