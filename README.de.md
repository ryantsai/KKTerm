<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>Ein einziges natives Windows-Fenster für Terminals, SSH, SFTP, RDP/VNC und ein Dashboard — plus eine KI, die dir auf Zuruf deine eigenen kleinen Tools baut.</strong>
</p>

<p align="center">
  <em>Weil deine Taskleiste nicht wie ein Spielautomat in Las Vegas aussehen sollte.</em>
</p>

<p align="center">
  <sub>Benannt nach <strong>乖乖 (Kuāi Kuāi)</strong>, dem grünen Kokos-Snack, den taiwanische Sysadmins auf Server legen, damit sie sich benehmen. Wir hoffen, diese App verdient sich ihren Platz im Rack.</sub>
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

## Der Pitch in 45 Sekunden

KKTerm vereint lokale Terminals, SSH/SFTP, FTP/FTPS, Telnet, serielle Verbindungen, RDP/VNC, eingebettete Webseiten, lokale Dateien und Dokumente in einem Desktop-Arbeitsbereich. Tabs können verschiedene Pane-Typen mischen, damit Terminal, Dateibrowser und Remote-Bildschirm für eine Aufgabe zusammenbleiben.

Es läuft unter Windows, macOS und Linux, speichert lokal und nutzt keine Telemetrie. Freigabepflichtige KI, anpassbare Dashboard-Widgets, Workspaces, IT Ops und der Windows Install Helper sind integriert.

---

## Warum „KKTerm"?

Geh in irgendein taiwanisches Rechenzentrum und schau oben auf die Racks. Vorbei an TSMC-Fabs, Leitständen der Taipei-Metro, Serverhallen der Cathay-Bank, Vermittlungstechnik von Chunghwa Telecom — du wirst ein kleines grünes Tütchen 乖乖 (Kuāi Kuāi) entdecken, einen Mais-Snack mit Kokosgeschmack aus den 1960ern.

**KKTerm** ist **Kuai Kuai Term** — ein Admin-Workspace, der dasselbe anstrebt wie der Snack: still neben deinen wichtigen Maschinen zu sitzen und ihnen zu helfen, sich zu benehmen. Local-first. Keine Telemetrie. KI mit Freigabe. Die langweilige, verlässliche Sorte Software.

Ein echtes Tütchen Kuai Kuai mit dem Installer auszuliefern, haben wir noch nicht geschafft. Das ist ein Punkt für v2.

---

## In Bewegung sehen

<p align="center">
  <a href="https://github.com/ryantsai/KKTerm">
    <img
      src="docs/assets/demo.gif"
      alt="KKTerm demo"
      width="720"
    />
  </a>
</p>

<p align="center"><sub><em>(Das Demo-GIF. Ein Bild sagt mehr als tausend Aufzählungspunkte, und uns gehen die Aufzählungspunkte aus.)</em></sub></p>

---

## Ein Fenster, jede Verbindung

| Du wolltest… | KKTerm macht's |
| --- | --- |
| Eine lokale PowerShell / cmd / WSL-Shell öffnen | Lokale Terminals, nebeneinander |
| Per SSH auf einen Server | SSH mit Schlüsseln, Agent, Passwörtern, Jump-Hosts und Port-Forwarding |
| Dateien auf diesem Server durchsehen | SFTP aus der SSH-Verbindung — Zweispalten-Ansicht, zum Übertragen ziehen |
| FTP zu einem NAS von 2012 | FTP / FTPS im selben Datei-Browser |
| Telnet zu uralter Technik | Ja, Telnet ist auch drin |
| Mit einem seriellen Port reden | Serielle Verbindungen — COM-Port und Baudrate wählen |
| Per Remote auf eine Windows-Kiste | Das echte Microsoft-Remotedesktop, gleich eingebaut |
| VNC auf einen Pi | VNC, direkt in den Workspace gerendert |
| Die Weboberfläche des Routers öffnen | Ein eingebetteter Browser-Tab mit gespeicherten Logins |
| Die eigene Platte durchsehen | Ein lokales File-Explorer-Pane, dieselbe Zweispalten-Hülle wie SFTP |
| Ein Log, CSV, Bild oder PDF öffnen | Ein eingebauter Document-Viewer mit echtem Tail-Follow-Log-Modus |
| Die CPU des Hosts beobachten | Eine Live-Statusleiste und ein Dashboard, das du selbst baust |

Dieselbe App. Dasselbe Fenster. Dieselben Hotkeys. Dasselbe, hoffentlich nicht augenfeindliche, Theme.

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="Ein einzelner Tab mit SSH, SFTP und einer eingebetteten Web-UI nebeneinander" width="720" />
</p>

---

## Warum Leute es den ganzen Tag offen lassen

### Kleiner Download, Blitzstart

KKTerm soll sich wie ein Werkzeug anfühlen, nicht wie eine Plattform. Aktuelle Desktop-Builds liegen unter 20 MB, installieren schnell und starten so flott, dass sich das Öffnen deines Admin-Workspace nicht wie das Starten eines zweiten Betriebssystems anfühlt.

### Multi-Pane-Grids, gemischt wie du arbeitest

Ein Tab kann ein Grid aus Panes enthalten, und diese Panes müssen nicht dieselbe Art haben. Lege SSH neben SFTP, eine lokale PowerShell unter eine RDP Session, VNC neben das Web-UI des Routers oder einen Dateibrowser neben das Terminal, das gerade Dateien verschiebt.

<p align="center">
  <img src="docs/assets/screenshots/multi-pane.png" alt="Ein Tab, geteilt in vier Panes verschiedener Verbindungsarten" width="720" />
</p>

### Ein KI-Assistent, der deine Terminals für dich steuert

Die meisten „KI im Terminal"-Demos hören beim Chat auf. Der Assistent von KKTerm arbeitet *in* deiner Session: Du gibst ihm Kontext aus dem, was schon auf dem Bildschirm ist, und er handelt an den Maschinen, mit denen du verbunden bist — mit einem Menschen in der Freigabeschleife.

<p align="center">
  <img src="docs/assets/screenshots/ai-assistant.png" alt="Das Panel des KI-Assistenten mit den Schaltern für Tool-Zugriff und Freigabemodus" width="720" />
</p>

### Ein Dashboard, das nicht so tut, als wäre es Grafana

Das Dashboard ist ein Raster aus Widgets, die man zieht und in der Größe ändert. Es ist nicht für Petabyte-Observability — es ist für „ich will einen Knopf, der meine fünf Lieblings-Apps startet, und ein Panel, das die Uptime meines SSH-Hosts zeigt, *neben* meinem Chat".

Dashboard-Ansichten bieten 45 in KKTerm integrierte animierte Hintergründe. Neu hinzugekommen sind acht prozedurale WebGL-Szenen: `heroGeometric`, `ditherPrismHero`, `webglLiquid`, `silkAurora`, `closingPlasma`, `animatedGradient`, `prismGradient` und `liquidChrome`. Derselbe Hintergrundwähler steht auch für Terminal-Verbindungen, den Dokumentbetrachter und IT-Ops-Detailansichten bereit; ausgeblendete oder nicht sichtbare Szenen stoppen das Rendering und geben ihre WebGL-Ressourcen frei.

<p align="center">
  <img src="docs/assets/screenshots/ai-widgets.png" alt="Ein Dashboard-Raster voller KI-erstellter Widgets" width="720" />
</p>

### IT Ops für Standorte, Hosts und wiederholbare Arbeit

Das **IT-Ops**-Modul gruppiert Verbindungen in Standorte, bildet Serverräume und Racks ab, verwaltet Hosts und führt wiederverwendbare Aufgaben auf ausgewählten Rechnern aus. Batch-Läufe speichern Ergebnisse pro Host; Automatisierungen verbinden Auslöser und Bedingungen mit Benachrichtigungen, Webhooks oder Aufgaben.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="Die IT-Ops-Serverraumansicht mit sechs bestückten Racks und Host-Statusanzeigen" width="720" />
</p>

### Screenshots aufnehmen, organisieren und kommentieren

Das **Screenshots**-Modul erfasst einen Bereich, ein Fenster oder den gesamten Desktop in einer lokalen Bibliothek, in der Zwischenablage oder in beidem. Aufnahmen lassen sich sortieren und gruppieren, stapelweise skalieren oder konvertieren und im integrierten Editor zuschneiden, freihändig markieren oder mit Pfeilen, Formen, Text und Mosaik-Unkenntlichmachung versehen. Globale Tastenkürzel und das Systemleistenmenü halten die Aufnahme jederzeit nur einen Tastendruck entfernt.

<p align="center">
  <img src="docs/assets/screenshots/screenshots-module.png" alt="Das Screenshots-Modul mit Aufnahmefunktionen und Vorschaubibliothek" width="720" />
</p>

### Deine KI-Agenten am Leben halten

Das ist die zweite Funktion, in die sich Leute verlieben. KKTerms SSH-Terminals können dich direkt in eine **benannte tmux-Session** auf dem entfernten Host setzen, die ein Wiederverbinden übersteht.

<p align="center">
  <img src="docs/assets/screenshots/tmux-reattach.png" alt="Ein SSH-Pane, das sich nach einer Wiederverbindung erneut an eine benannte tmux-Session anhängt" width="720" />
</p>

### Mit Workspaces deine Welten trennen

Das Homelab, der Hauptjob und die Server dieses einen Kunden gehören nicht in dieselbe Liste. **Workspaces** sind benannte, isolierte Container von Connections, zwischen denen du über das Activity Rail umschaltest. Das Umschalten re-skopiert nur den Verbindungsbaum — deine offenen Sessions, das Dashboard und die Einstellungen bleiben, wo sie sind — also kostet ein Kontextwechsel einen Klick, keinen Neustart.

<p align="center">
  <img src="docs/assets/screenshots/workspaces.png" alt="Der Workspace-Umschalter im Activity Rail" width="720" />
</p>

### Mach's dir schön: Farbthemen

Hintergründe sind der Spaß; **Farbthemen** sind das, worauf du den ganzen Tag tatsächlich starrst. KKTerm bringt **sechsundzwanzig** Farbschemata mit, die die ganze App-Oberfläche neu einkleiden — Activity Rail, Verbindungsbaum, Tabs, Dialoge — mit einer Live-Mini-Vorschau für jedes unter Einstellungen ▸ Darstellung.

<p align="center">
  <img src="docs/assets/screenshots/color-themes.png" alt="Das Raster der Farbschemata in den Einstellungen mit Live-Vorschauen" width="720" />
</p>

### Install Helper (nur Windows)

Eine frische Windows-Maschine fürs Entwickeln einzurichten heißt sonst zehn Browser-Tabs und viel „Weiter, Weiter, Fertig". Der **Install Helper** ist ein eingebauter Katalog, der die Tools, die du sonst von Hand jagst, findet, installiert, aktualisiert und deinstalliert — ohne KKTerm zu verlassen.

<p align="center">
  <img src="docs/assets/screenshots/install-helper.png" alt="Der Install-Helper-Katalog mit installierten und verfügbaren Tools" width="720" />
</p>

---

## Was KKTerm nicht ist

Eine kurze Liste, denn Ehrlichkeit verdient Vertrauen:

- **Kein Cloud-Produkt.** Keine Synchronisierung, keine Team-Konten, keine SaaS-Stufe. Wenn du je einen Dialog „Bei KKTerm anmelden" siehst, ist etwas katastrophal schiefgelaufen.
- **Tut nicht so, als wären alle Betriebssysteme identisch.** KKTerm veröffentlicht Builds für Windows, macOS und Linux, hält plattformspezifische Funktionen aber klar und ehrlich gekennzeichnet.
- **Kein autonomer KI-Agent.** Der Assistent schlägt vor; der Mensch entscheidet. `Allow All` ist eine Wahl, die du triffst, kein Standard.
- **Kein Grafana-/Datadog-Ersatz.** Das Dashboard ist für persönliche Kontroll-Oberflächen, nicht für Observability über 10.000 Hosts.
- **Keine Kubernetes-IDE.** Es ist ein Terminal-zentrierter Admin-Workspace. Bitte verlang nicht, dass es ein Helm-Chart rendert.

Falls einer dieser Punkte *früher* ein K.-o.-Kriterium war — fair genug, dann sehen wir uns in v2.

---

## KKTerm holen

**[Lad die neueste KKTerm-Version herunter](https://github.com/ryantsai/KKTerm/releases/latest)**, wähl das Paket für deine Plattform aus und starte es. Windows-Installer sind derzeit **unsigniert** — Release-Signierung steht auf der Roadmap, also kann dich dein Virenscanner bis dahin streng anschauen. Das ist normal.

Aus dem Quellcode bauen oder mitmachen? Alles, was du brauchst, steht in [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Roadmap (Kurzfassung)

- Feinschliff für plattformübergreifende Releases
- Feinschliff für Release-Signierung
- Mehr Dateiübertragungs-Power (Fortsetzen, Ordner-Sync, Archivieren/Entpacken)
- Reichere Zwischenablage- und Geräte-Freigabe fürs Remotedesktop
- Mehr eingebaute Dashboard-Widgets
- Mehr IT-Ops-Automatisierungsfunktionen

Vollständige, häufig aktualisierte Version: [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Mitwirken

Über eine helfende Hand würden wir uns sehr freuen. Ehrlich. Auch Kleinigkeiten zählen.

Komplettes Setup, Projektstruktur und PR-Checkliste stehen in [`CONTRIBUTING.md`](CONTRIBUTING.md). Auf der Suche nach einem Einstieg? Filtere offene Issues nach [`good first issue`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) oder [`help wanted`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22).

---

## Projektdokumente

- [Produktkontext](CONTEXT.md) — die Fachsprache, an die du dich halten solltest
- [Architektur](docs/ARCHITECTURE.md) — Modul-Karte, wohin mit neuem Code
- [Benutzerhandbuch](docs/manual/INDEX.md) — ein Rundgang Funktion für Funktion
- [Roadmap](docs/ROADMAP.md)
- [Dashboard-Architektur](docs/DASHBOARD.md)
- [Eingebauter MCP-Server](docs/MCP.md)
- [KI-Provider-Leitfaden](docs/AI_PROVIDERS.md)

---

## Lizenz

MIT. Siehe [LICENSE](LICENSE). Nutz es, fork es, liefer es aus, pack es in ein Homelab, das sonst niemand findet — das ist der Deal.
