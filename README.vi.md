<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>Một cửa sổ Windows native duy nhất cho terminal, SSH, SFTP, RDP/VNC và một dashboard — cộng thêm một AI dựng cho bạn những công cụ nhỏ của riêng bạn theo yêu cầu.</strong>
</p>

<p align="center">
  <em>Vì thanh tác vụ của bạn không nên trông như một cái máy đánh bạc ở Las Vegas.</em>
</p>

<p align="center">
  <sub>Đặt tên theo <strong>乖乖 (Kuāi Kuāi)</strong>, món snack bắp vị dừa màu xanh mà các sysadmin Đài Loan đặt lên server để chúng ngoan ngoãn. Mong rằng app này cũng giành được chỗ của nó trên rack.</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">Tải bản phát hành KKTerm mới nhất</a></strong>
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

## Lời chào trong 45 giây

KKTerm đưa terminal cục bộ, SSH/SFTP, FTP/FTPS, Telnet, cổng serial, RDP/VNC, trang web nhúng, tệp cục bộ và tài liệu vào cùng một workspace desktop. Một Tab có thể kết hợp nhiều loại Pane để terminal, trình duyệt tệp và màn hình từ xa của cùng một công việc luôn nằm cạnh nhau.

Ứng dụng chạy trên Windows, macOS và Linux, lưu dữ liệu cục bộ và không dùng telemetry. AI có bước phê duyệt, widget Dashboard tùy chỉnh, Workspace, IT Ops và Install Helper cho Windows đều được tích hợp.

---

## Vì sao là "KKTerm"?

Bước vào bất kỳ trung tâm dữ liệu nào ở Đài Loan và nhìn lên đỉnh các rack. Vượt qua các fab của TSMC, phòng điều khiển Metro Đài Bắc, phòng máy chủ của ngân hàng Cathay, thiết bị chuyển mạch của Chunghwa Telecom — bạn sẽ thấy một túi nhỏ màu xanh 乖乖 (Kuāi Kuāi), món snack bắp vị dừa từ thập niên 1960.

**KKTerm** là **Kuai Kuai Term** — một không gian quản trị mong làm đúng công việc của món snack: ngồi lặng lẽ bên cạnh các cỗ máy quan trọng của bạn và giúp chúng cư xử đàng hoàng. Local-first. Không telemetry. AI phải được phê duyệt. Loại phần mềm buồn tẻ mà đáng tin cậy.

Tụi mình vẫn chưa thể kèm một túi Kuai Kuai thật vào bộ cài. Đó là việc của v2.

---

## Xem nó chuyển động

<p align="center">
  <a href="https://github.com/ryantsai/KKTerm">
    <img
      src="docs/assets/demo.gif"
      alt="KKTerm demo"
      width="720"
    />
  </a>
</p>

<p align="center"><sub><em>(GIF demo. Một bức ảnh đáng giá nghìn gạch đầu dòng, mà tụi mình thì hết gạch đầu dòng rồi.)</em></sub></p>

---

## Một cửa sổ, mọi kết nối

| Bạn muốn… | KKTerm làm được |
| --- | --- |
| Mở shell cục bộ PowerShell / cmd / WSL | Terminal cục bộ, kề nhau |
| SSH vào một server | SSH với khóa, agent, mật khẩu, jump host và port forwarding |
| Duyệt tệp trên server đó | SFTP từ kết nối SSH — hai khung, kéo để truyền |
| FTP đến một NAS từ 2012 | FTP / FTPS trong cùng trình duyệt tệp |
| Telnet đến thiết bị cổ lỗ | Đúng, Telnet cũng có trong đó |
| Nói chuyện với cổng serial | Kết nối serial — chọn cổng COM và baud |
| Remote vào một máy Windows | Remote Desktop Microsoft xịn, tích hợp sẵn |
| VNC vào một con Pi | VNC, render thẳng vào không gian làm việc |
| Mở giao diện web của router | Một tab trình duyệt nhúng với thông tin đăng nhập đã lưu |
| Duyệt ổ đĩa của chính bạn | Một pane File Explorer cục bộ, cùng lớp vỏ hai khung như SFTP |
| Mở một log, CSV, ảnh hoặc PDF | Một trình xem Document tích hợp với chế độ log tail-follow đúng nghĩa |
| Theo dõi CPU của host | Một thanh trạng thái thời gian thực và một dashboard bạn tự dựng |

Cùng một app. Cùng một cửa sổ. Cùng phím tắt. Cùng một theme, mong là không làm mắt bạn chảy máu.

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="Một Tab duy nhất chứa SSH, SFTP và một Web UI nhúng kề nhau" width="720" />
</p>

---

## Vì sao người ta để mở nó cả ngày

### Tải xuống nhỏ, khởi động nhanh như chớp

KKTerm được xây để có cảm giác như một tiện ích, không phải một nền tảng. Các bản desktop hiện tại dưới 20 MB, cài nhanh và khởi động đủ nhanh để việc mở workspace quản trị không giống như đang bật thêm một hệ điều hành thứ hai.

### Lưới nhiều Pane, trộn đúng cách bạn làm việc

Một Tab có thể chứa một lưới Panes, và các Panes đó không cần cùng loại. Đặt SSH cạnh SFTP, PowerShell cục bộ dưới một RDP Session, VNC cạnh Web UI của router, hoặc trình duyệt tệp cạnh terminal đang chuyển tệp.

<p align="center">
  <img src="docs/assets/screenshots/multi-pane.png" alt="Một Tab chia thành bốn pane với các loại kết nối khác nhau" width="720" />
</p>

### Một trợ lý AI điều khiển các terminal thay bạn

Phần lớn các demo "AI trong terminal" dừng ở chat. Trợ lý của KKTerm làm việc *bên trong* phiên của bạn: bạn trao cho nó ngữ cảnh từ những gì đã có sẵn trên màn hình, và nó ra tay trên những máy bạn đang kết nối — với một con người luôn ở trong vòng phê duyệt.

<p align="center">
  <img src="docs/assets/screenshots/ai-assistant.png" alt="Bảng trợ lý AI với các công tắc truy cập công cụ và chế độ phê duyệt" width="720" />
</p>

### Một dashboard không giả vờ làm Grafana

Dashboard là một lưới widget mà bạn kéo và đổi kích thước. Nó không dành cho observability quy mô petabyte — nó dành cho "tôi muốn một nút mở năm app yêu thích và một bảng hiện uptime của host SSH, *bên cạnh* khung chat của tôi".

Dashboard View có 45 hình nền động tích hợp sẵn trong KKTerm. Tám hình nền mới nhất là các cảnh WebGL được tạo theo thủ tục: `heroGeometric`, `ditherPrismHero`, `webglLiquid`, `silkAurora`, `closingPlasma`, `animatedGradient`, `prismGradient` và `liquidChrome`. Cùng một bộ chọn hình nền cũng dùng được cho Terminal Connection, Document viewer và các chế độ xem chi tiết của IT Ops; cảnh bị ẩn hoặc nằm ngoài màn hình sẽ dừng kết xuất và giải phóng tài nguyên WebGL.

<p align="center">
  <img src="docs/assets/screenshots/ai-widgets.png" alt="Một lưới dashboard đầy widget do AI tạo" width="720" />
</p>

### IT Ops cho Site, Host và công việc lặp lại

Module **IT Ops** nhóm Connection thành Site, mô phỏng Server Room và Rack, quản lý Host và chạy Task có thể tái sử dụng trên các máy đã chọn. Batch Run lưu kết quả theo từng Host, còn Automation nối điều kiện kích hoạt với thông báo, webhook hoặc Task.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="Chế độ xem mặt trước Server Room của IT Ops với sáu Rack chứa thiết bị và chỉ báo trạng thái Host" width="720" />
</p>

### Chụp, sắp xếp và chú thích ảnh chụp màn hình

Module **Screenshots** chụp một vùng, một cửa sổ hoặc toàn bộ desktop vào thư viện cục bộ, clipboard hoặc cả hai. Bạn có thể sắp xếp và nhóm ảnh, đổi kích thước hoặc định dạng hàng loạt, rồi mở bất kỳ ảnh nào trong trình chỉnh sửa tích hợp để cắt, vẽ tự do, thêm mũi tên, hình khối và chữ, hoặc che thông tin bằng hiệu ứng mosaic. Phím tắt toàn cục và menu khay hệ thống giúp bạn bắt đầu chụp chỉ với một tổ hợp phím.

<p align="center">
  <img src="docs/assets/screenshots/screenshots-module.png" alt="Module Screenshots với các nút chụp và thư viện ảnh thu nhỏ" width="720" />
</p>

### Giữ cho các agent AI của bạn sống

Đây là tính năng thứ hai khiến người ta mê. Terminal SSH của KKTerm có thể thả bạn thẳng vào một **phiên tmux có tên** trên host từ xa, sống sót qua việc kết nối lại.

<p align="center">
  <img src="docs/assets/screenshots/tmux-reattach.png" alt="Một pane SSH gắn lại vào một phiên tmux có tên sau khi kết nối lại" width="720" />
</p>

### Tách biệt các thế giới của bạn bằng Workspaces

Homelab, công việc chính và đám server của khách hàng kia không thuộc về cùng một danh sách. **Workspaces** là các hộp chứa Connections có tên, biệt lập, mà bạn chuyển đổi từ Activity Rail. Chuyển đổi chỉ định lại phạm vi cho cây kết nối — các Sessions đang mở, Dashboard và Cài đặt của bạn vẫn nguyên chỗ — nên đổi ngữ cảnh tốn một cú nhấp, không phải khởi động lại.

<p align="center">
  <img src="docs/assets/screenshots/workspaces.png" alt="Bộ chuyển workspace trong activity rail" width="720" />
</p>

### Khoác áo theo ý bạn: chủ đề màu

Hình nền là phần vui; **chủ đề màu** mới là thứ bạn thực sự nhìn cả ngày. KKTerm mang theo **hai mươi sáu** bộ phối màu khoác lại toàn bộ giao diện ứng dụng — Activity Rail, cây kết nối, tab, hộp thoại — kèm bản xem trước thu nhỏ trực tiếp cho từng bộ trong Cài đặt ▸ Giao diện.

<p align="center">
  <img src="docs/assets/screenshots/color-themes.png" alt="Lưới bộ phối màu trong Cài đặt với bản xem trước trực tiếp" width="720" />
</p>

### Install Helper (chỉ Windows)

Thiết lập một máy Windows mới để làm dev thường có nghĩa là mười tab trình duyệt và rất nhiều "tiếp theo, tiếp theo, hoàn tất". **Install Helper** là một danh mục tích hợp tìm, cài, cập nhật và gỡ các công cụ mà nếu không bạn phải tự lùng bằng tay — ngay trong KKTerm.

<p align="center">
  <img src="docs/assets/screenshots/install-helper.png" alt="Danh mục Install Helper với các công cụ đã cài và có thể cài" width="720" />
</p>

---

## KKTerm không phải là gì

Một danh sách ngắn, vì sự trung thực đổi lấy niềm tin:

- **Không phải sản phẩm đám mây.** Không đồng bộ, không tài khoản nhóm, không gói SaaS. Nếu một ngày bạn thấy hộp thoại "Đăng nhập vào KKTerm", thì có gì đó đã sai một cách thảm họa.
- **Không giả vờ mọi hệ điều hành đều giống nhau.** KKTerm phát hành bản Windows, macOS và Linux, nhưng vẫn ghi rõ các tính năng riêng của từng nền tảng.
- **Không phải agent AI tự hành.** Trợ lý đề xuất; con người quyết định. `Allow All` là lựa chọn bạn đưa ra, không phải mặc định.
- **Không phải bản thay thế Grafana / Datadog.** Dashboard dành cho các bề mặt điều khiển cá nhân, không phải observability cho 10.000 host.
- **Không phải IDE Kubernetes.** Đây là một không gian quản trị lấy terminal làm trung tâm. Xin đừng bắt nó render một Helm chart.

Nếu một trong số đó *từng* là yếu tố quyết định — cũng phải thôi, hẹn gặp ở v2.

---

## Tải KKTerm

**[Tải bản phát hành KKTerm mới nhất](https://github.com/ryantsai/KKTerm/releases/latest)**, chọn gói dành cho nền tảng của bạn rồi mở nó. Bộ cài Windows hiện **chưa được ký** — việc ký bản phát hành nằm trong roadmap, nên đến lúc đó phần mềm diệt virus của bạn có thể nhìn bạn nghiêm khắc. Đó là chuyện bình thường.

Muốn build từ mã nguồn hay đóng góp? Mọi thứ bạn cần đều nằm trong [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Roadmap (bản ngắn)

- Hoàn thiện bản phát hành đa nền tảng
- Hoàn thiện chữ ký bản phát hành
- Truyền tệp mạnh hơn (tiếp tục, đồng bộ thư mục, nén/giải nén)
- Chia sẻ clipboard và thiết bị Remote Desktop phong phú hơn
- Thêm widget dashboard có sẵn
- Thêm chức năng tự động hóa IT Ops

Bản đầy đủ và cập nhật thường xuyên: [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Đóng góp

Tụi mình rất mong có người chung tay. Thật đấy. Việc nhỏ cũng quan trọng.

Toàn bộ thiết lập, cấu trúc dự án và checklist PR nằm trong [`CONTRIBUTING.md`](CONTRIBUTING.md). Đang tìm điểm khởi đầu? Lọc các issue đang mở theo [`good first issue`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) hoặc [`help wanted`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22).

---

## Tài liệu dự án

- [Bối cảnh sản phẩm](CONTEXT.md) — ngôn ngữ miền bạn nên tuân theo
- [Kiến trúc](docs/ARCHITECTURE.md) — bản đồ module, đặt mã mới ở đâu
- [Sổ tay người dùng](docs/manual/INDEX.md) — đi qua từng tính năng một
- [Roadmap](docs/ROADMAP.md)
- [Kiến trúc Dashboard](docs/DASHBOARD.md)
- [Server MCP tích hợp](docs/MCP.md)
- [Hướng dẫn nhà cung cấp AI](docs/AI_PROVIDERS.md)

---

## Giấy phép

MIT. Xem [LICENSE](LICENSE). Dùng nó, fork nó, phát hành nó, đặt nó vào một homelab không ai khác tìm ra — đó là giao kèo.
