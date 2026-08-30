<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>พื้นที่ทำงานเดสก์ท็อปข้ามแพลตฟอร์มสำหรับเทอร์มินัล, SSH/SFTP, RDP/VNC, ไฟล์, เว็บ, IT Ops และผู้ช่วย AI ที่ต้องผ่านการอนุมัติ</strong>
</p>

<p align="center">
  <em>เพราะทาสก์บาร์ของคุณไม่ควรหน้าตาเหมือนตู้สล็อตที่ลาสเวกัส</em>
</p>

<p align="center">
  <sub>ตั้งชื่อตาม <strong>乖乖 (Kuāi Kuāi)</strong> ขนมข้าวโพดรสมะพร้าวสีเขียวที่แอดมินระบบชาวไต้หวันวางไว้บนเซิร์ฟเวอร์เพื่อให้มันทำงานดี ๆ</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">ดาวน์โหลด KKTerm รุ่นล่าสุด</a></strong>
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
    <img src="https://img.shields.io/badge/Buy_Me_a_Coffee-%E2%98%95-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="เลี้ยงกาแฟฉันสักแก้ว" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="เดสก์ท็อปข้ามแพลตฟอร์ม" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="เก็บข้อมูลในเครื่อง ไม่มี telemetry" />
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
    <strong>ไทย</strong> ·
    <a href="README.id.md">Bahasa Indonesia</a> ·
    <a href="README.vi.md">Tiếng Việt</a>
  </sub>
</p>

---

## ทำไมถึงชื่อ "KKTerm"?

KKTerm ย่อมาจาก **Kuai Kuai Term** โดยอ้างอิงถึง 乖乖 สีเขียวที่แอดมินระบบชาวไต้หวันวางไว้บนเซิร์ฟเวอร์ เพื่อให้เครื่องสำคัญทำงานเงียบ ๆ เชื่อถือได้ และเรียบร้อย

## หน้าต่างเดียว ทุกการเชื่อมต่อ

KKTerm รวมเชลล์ในเครื่อง, SSH/SFTP, FTP/FTPS, Telnet, serial, RDP/VNC, การเชื่อมต่อ URL, File Explorer ในเครื่อง และตัวดูเอกสารไว้ในพื้นที่ทำงานเดสก์ท็อปเดียว Tab สามารถผสม Pane หลายประเภท เพื่อให้เทอร์มินัล เบราว์เซอร์ไฟล์ เว็บ UI และหน้าจอระยะไกลของงานเดียวกันอยู่ด้วยกัน

| การใช้งาน | KKTerm |
| --- | --- |
| เชลล์ในเครื่อง | PowerShell, cmd และ WSL |
| การเข้าถึงระยะไกล | SSH, Telnet, serial, RDP และ VNC |
| ไฟล์และเว็บ | SFTP, FTP/FTPS, ไฟล์ในเครื่อง และการเชื่อมต่อ URL แบบฝัง |
| เอกสาร | log แบบติดตามต่อเนื่อง, ข้อความ, CSV, รูปภาพ และ PDF |

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="Pane ของ SSH, SFTP, เทอร์มินัล, URL และ RDP ใน Tab เดียวของ KKTerm" width="720" />
</p>

## งานรอบ ๆ เทอร์มินัล

- **Workspace** — ผสม Tab และ Pane, Workspace แบบตั้งชื่อ, tmux reattach, Connection Notes, Git Browser และ File Compare
- **AI Assistant** — เครื่องมือที่ต้องอนุมัติสำหรับ Session, Dashboard, IT Ops และ Custom Modules พร้อมไฟล์แนบ การส่งไปยังเทอร์มินัล MCP และ Assistant Skills ที่นำกลับมาใช้ได้
- **Dashboard** — View ที่สลับได้ พร้อม Widget ในตัวหรือที่ AI สร้าง ซึ่งลากและปรับขนาดได้ รวม App Launcher, แผง Connection แบบสด, Notes, ตัววัดการใช้งาน และเครื่องมืออรรถประโยชน์
- **IT Ops** — โทโพโลยี Site → Server Room → Rack (elevation, floor plan และมุมมอง 2.5D), inventory ของ Host และการสแกนการเชื่อมต่อ, Script/Playbook Task ที่ใช้ซ้ำได้, Batch Run ผ่าน SSH/WinRM/PsExec, IPAM, VLAN, Network Map, ประวัติการทำงาน และการส่งออก PDF/CSV
- **Screenshots** — จับภาพพื้นที่ หน้าต่าง หรือเดสก์ท็อปทั้งหมด บันทึกลงไลบรารีในเครื่องหรือคลิปบอร์ด ปรับขนาด/แปลงไฟล์เป็นชุด และใส่คำอธิบายด้วยการครอป รูปร่าง ข้อความ และโมเสก
- **Custom Modules** — ติดตั้งแพ็กเกจ `.kkmod` แบบแยกส่วนจาก Settings ตรวจสอบสิทธิ์ที่ประกาศไว้ เพิ่มปลายทางใน Activity Rail และจัดการการอัปเดต rollback พื้นที่เก็บข้อมูล และการถอนการติดตั้งได้ รีโพซิทอรีมีการผสานรวมอย่าง Excalidraw, BentoPDF, OpenFlowKit และ TiddlyWiki
- **Install Helper (Windows)** — ค้นหา ติดตั้ง อัปเดต และถอนการติดตั้งเครื่องมือ รวมถึงเว็บแอปและบริการในเครื่องที่รองรับ โดยไม่ต้องออกจาก KKTerm

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="Rack elevation ของ IT Ops พร้อมตัวบ่งชี้สถานะอุปกรณ์" width="720" />
</p>

## ปรับให้เป็นสไตล์ของคุณ

Dashboard View, Connection ของเทอร์มินัล, ตัวดูเอกสาร และ drill view ของ IT Ops ใช้ตัวเลือกพื้นหลังร่วมกัน เลือกสีและไล่ระดับ รูปภาพและวิดีโอในเครื่อง หรือ **พื้นหลังแบบไดนามิกในตัว 84 แบบ** ตั้งแต่มหาสมุทรและสภาพอากาศ ไปจนถึงฉาก WebGL อวกาศ กราฟิกเครือข่าย และการเคลื่อนไหวแบบนามธรรม ฉากที่ซ่อนหรืออยู่นอกจอจะหยุดชั่วคราวและคืนทรัพยากรการเรนเดอร์ ธีมสี รูปลักษณ์เทอร์มินัล ฟอนต์แบบกำหนดเอง และพื้นหลังต่อ Connection ช่วยปรับแต่งได้ยิ่งขึ้น

<p align="center">
  <img src="docs/assets/screenshots/backgrounds.png" alt="ตัวเลือกพื้นหลังแบบไดนามิกของ KKTerm" width="720" />
</p>

## ดูการทำงานจริง

<p align="center">
  <img src="docs/assets/demo.gif" alt="เดโม KKTerm" width="720" />
</p>

## รับ KKTerm

ดาวน์โหลด [รุ่นล่าสุด](https://github.com/ryantsai/KKTerm/releases/latest) สำหรับ Windows, macOS หรือ Linux Windows มีตัวติดตั้งและ ZIP แบบพกพาสำหรับ x64/ARM64 ให้แตก ZIP แบบพกพาไปยังโฟลเดอร์ในเครื่องที่เขียนได้หรือไดรฟ์ถอดได้ อย่าเรียกใช้จากตำแหน่งแชร์บนเครือข่าย ตรวจสอบไฟล์ `.sha256` ที่อยู่ข้างเคียงก่อนเรียกใช้แพ็กเกจ

หากต้องการ build จากซอร์ส ให้เริ่มจาก [`CONTRIBUTING.md`](CONTRIBUTING.md)

## ร่วมพัฒนา สนับสนุน และเอกสาร

ยินดีรับการมีส่วนร่วมและรายงานบั๊ก ดู [`CONTRIBUTING.md`](CONTRIBUTING.md), [คู่มือการใช้งาน](docs/manual/INDEX.md), [สถาปัตยกรรม](docs/ARCHITECTURE.md), [คู่มือ Dashboard](docs/DASHBOARD.md), [คู่มือ IT Ops](docs/ITOPS.md) และ [Custom Module Host API](docs/KKMOD_HOST_API_V2.md)

ถ้า KKTerm มีประโยชน์สำหรับคุณ สามารถ[เลี้ยงกาแฟฉันสักแก้ว](https://buymeacoffee.com/ryantsai)ได้

## สัญญาอนุญาต

ซอร์สโค้ดของ KKTerm ใช้ MIT พร้อม Commons Clause ส่วน crate ที่ vendored, Custom Modules, ฟอนต์ และแพ็กไอคอนยังคงใช้สัญญาอนุญาตของตนเอง ดู [`LICENSE`](LICENSE) และไฟล์ประกาศในไดเรกทอรีที่เกี่ยวข้อง
