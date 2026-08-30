<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>Eine plattformübergreifende Desktop-Arbeitsumgebung für Terminals, SSH/SFTP, RDP/VNC, Dateien, Web, IT Ops und einen genehmigungspflichtigen KI-Assistenten.</strong>
</p>

<p align="center">
  <em>Deine Taskleiste muss nicht wie ein Spielautomaten-Casino in Las Vegas aussehen.</em>
</p>

<p align="center">
  <sub>Der Name kommt von <strong>乖乖 (Kuāi Kuāi)</strong>, dem grünen Kokosnuss-Snack, den taiwanische Systemadministratoren auf Server stellen, damit sie sich benehmen.</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">Neueste KKTerm-Version herunterladen</a></strong>
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
    <img src="https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-blue?style=for-the-badge" alt="MIT-Lizenz mit Commons Clause" />
  </a>
  <a href="https://buymeacoffee.com/ryantsai">
    <img src="https://img.shields.io/badge/Buy_Me_a_Coffee-%E2%98%95-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Spendiere mir einen Kaffee" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="Plattformübergreifender Desktop" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="Lokal zuerst, keine Telemetrie" />
  <br />
  <sub>
    <a href="README.md">English</a> ·
    <a href="README.zh-TW.md">繁體中文</a> ·
    <a href="README.zh-CN.md">简体中文</a> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="README.ko.md">한국어</a> ·
    <a href="README.fr.md">Français</a> ·
    <strong>Deutsch</strong> ·
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

## Warum „KKTerm“?

KKTerm steht für **Kuai Kuai Term** — eine Anspielung auf das grüne 乖乖, das taiwanische Systemadministratoren auf Server stellen, damit wichtige Maschinen ruhig, zuverlässig und brav laufen.

## Ein Fenster, jede Verbindung

KKTerm vereint lokale Shells, SSH/SFTP, FTP/FTPS, Telnet, serielle Verbindungen, RDP/VNC, URL-Verbindungen, den lokalen Datei-Explorer und den Dokument-Viewer in einer Desktop-Arbeitsumgebung. Ein Tab kann verschiedene Pane-Typen mischen, damit Terminal, Dateibrowser, Weboberfläche und Remote-Bildschirm zusammenbleiben.

| Bedarf | KKTerm |
| --- | --- |
| Lokale Shells | PowerShell, cmd und WSL |
| Fernzugriff | SSH, Telnet, seriell, RDP und VNC |
| Dateien und Web | SFTP, FTP/FTPS, lokale Dateien und eingebettete URL-Verbindungen |
| Dokumente | Logs mit fortlaufender Verfolgung, Text, CSV, Bilder und PDFs |

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="Gemischte SSH-, SFTP-, Terminal-, URL- und RDP-Panes in einem KKTerm-Tab" width="720" />
</p>

## Für die Arbeit rund ums Terminal

- **Workspace** — gemischte Tabs und Panes, benannte Workspaces, tmux-Wiederverbindung, Connection Notes, Git Browser und File Compare.
- **KI-Assistent** — genehmigungspflichtige Werkzeuge für Sessions, Dashboard, IT Ops und Custom Modules sowie Anhänge, Senden an das Terminal, MCP und wiederverwendbare Assistant Skills.
- **Dashboard** — wechselbare Views mit verschiebbaren und skalierbaren integrierten oder KI-erstellten Widgets, App Launcher, Live-Connection-Panels, Notes, Nutzungsanzeigen und Werkzeugen.
- **IT Ops** — Site-Topologie mit Server Rooms und Racks (Elevation, Grundriss und 2.5D-Ansicht), Host-Inventar und Verbindungsscans, wiederverwendbare Script-/Playbook-Tasks, Batch Runs über SSH/WinRM/PsExec, IPAM, VLANs, Network Maps, Verlauf und PDF/CSV-Export.
- **Screenshots** — Bereich, Fenster oder gesamten Desktop aufnehmen, in einer lokalen Bibliothek oder der Zwischenablage speichern, stapelweise skalieren/konvertieren und mit Zuschnitt, Formen, Text und Mosaik annotieren.
- **Custom Modules** — isolierte `.kkmod`-Pakete über Settings installieren, deklarierte Berechtigungen prüfen, Rail-Ziele hinzufügen sowie Updates, Rollback, Speicher und Deinstallation verwalten. Das Repository enthält unter anderem Integrationen für Excalidraw, BentoPDF, OpenFlowKit und TiddlyWiki.
- **Install Helper (Windows)** — Tools sowie unterstützte lokale Web-Apps und Dienste suchen, installieren, aktualisieren und deinstallieren, ohne KKTerm zu verlassen.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="IT Ops Server-Room-Elevations mit Rack-Geräten und Zustandsanzeigen" width="720" />
</p>

## Deine Arbeitsumgebung, dein Stil

Dashboard-Views, Terminal-Connections, der Dokument-Viewer und IT-Ops-Drilldown-Views verwenden denselben Hintergrundwähler. Zur Auswahl stehen Farb- und Verlaufsvorlagen, lokale Bilder und Videos sowie **84 integrierte dynamische Hintergründe** — von Ozean und Wetter über WebGL-Szenen und Weltraum bis zu Netzwerk- und abstrakten Grafiken. Verborgene oder vollständig außerhalb des Bildschirms liegende Szenen pausieren und geben ihre Render-Ressourcen frei. Farbthemen, Terminal-Optik, eigene Schriften und Hintergründe pro Connection ergänzen die Anpassung.

<p align="center">
  <img src="docs/assets/screenshots/backgrounds.png" alt="KKTerms Auswahl dynamischer Hintergründe" width="720" />
</p>

## KKTerm in Aktion

<p align="center">
  <img src="docs/assets/demo.gif" alt="KKTerm-Demo" width="720" />
</p>

## KKTerm herunterladen

Lade die [neueste Version](https://github.com/ryantsai/KKTerm/releases/latest) für Windows, macOS oder Linux herunter. Windows bietet ein Setup-Programm sowie portable ZIPs für x64/ARM64. Entpacke ein portables ZIP in einen lokal beschreibbaren Ordner oder auf ein Wechsellaufwerk, nicht in eine Netzwerkfreigabe. Prüfe vor dem Start die danebenliegende `.sha256`-Datei.

Für einen Build aus dem Quellcode lies zuerst [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Beitragen, unterstützen und Dokumentation

Beiträge und Fehlerberichte sind willkommen. Siehe [`CONTRIBUTING.md`](CONTRIBUTING.md), das [Benutzerhandbuch](docs/manual/INDEX.md), die [Architektur](docs/ARCHITECTURE.md), den [Dashboard-Leitfaden](docs/DASHBOARD.md), den [IT-Ops-Leitfaden](docs/ITOPS.md) und die [Custom-Module-Host-API](docs/KKMOD_HOST_API_V2.md).

Wenn KKTerm nützlich ist, kannst du [mir einen Kaffee spendieren](https://buymeacoffee.com/ryantsai).

## Lizenz

Der KKTerm-Quellcode steht unter MIT mit Commons Clause. Vendored Crates, Custom Modules, Schriften und Icon-Pakete unterliegen weiterhin ihren jeweiligen Lizenzen; Details stehen in [`LICENSE`](LICENSE) und den Hinweisen ihrer Verzeichnisse.
