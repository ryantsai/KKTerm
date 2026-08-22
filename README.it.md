<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>Uno spazio di lavoro desktop multipiattaforma per terminali, SSH/SFTP, RDP/VNC, file, Web, IT Ops e un assistente IA soggetto ad approvazione.</strong>
</p>

<p align="center">
  <em>Perché la barra delle applicazioni non dovrebbe sembrare una slot machine di Las Vegas.</em>
</p>

<p align="center">
  <sub>Il nome viene da <strong>乖乖 (Kuāi Kuāi)</strong>, lo snack verde al cocco che gli amministratori di sistema taiwanesi mettono sui server perché si comportino bene.</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">Scarica l’ultima versione di KKTerm</a></strong>
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
    <img src="https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-blue?style=for-the-badge" alt="Licenza MIT con Commons Clause" />
  </a>
  <a href="https://github.com/sponsors/ryantsai">
    <img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sostieni KKTerm su GitHub" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="Desktop multipiattaforma" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="Local-first, senza telemetria" />
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
    <strong>Italiano</strong> ·
    <a href="README.pt-BR.md">Português (BR)</a> ·
    <a href="README.th.md">ไทย</a> ·
    <a href="README.id.md">Bahasa Indonesia</a> ·
    <a href="README.vi.md">Tiếng Việt</a>
  </sub>
</p>

---

## Perché «KKTerm»?

KKTerm significa **Kuai Kuai Term**: un richiamo al 乖乖 verde che gli amministratori taiwanesi mettono sui server perché le macchine importanti restino silenziose, affidabili e ben educate.

## Una finestra, ogni connessione

KKTerm riunisce shell locali, SSH/SFTP, FTP/FTPS, Telnet, connessioni seriali, RDP/VNC, connessioni URL, File Explorer locale e visualizzatore di documenti in un unico spazio di lavoro. Un Tab può mescolare tipi diversi di Pane, così terminale, file, interfaccia Web e schermo remoto restano insieme.

| Esigenza | KKTerm |
| --- | --- |
| Shell locali | PowerShell, cmd e WSL |
| Accesso remoto | SSH, Telnet, seriale, RDP e VNC |
| File e Web | SFTP, FTP/FTPS, file locali e connessioni URL incorporate |
| Documenti | Log con tail-follow, testo, CSV, immagini e PDF |

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="Pane SSH, SFTP, terminale, URL e RDP mescolati in un Tab di KKTerm" width="720" />
</p>

## Tutto ciò che gira intorno al terminale

- **Workspace** — Tab e Pane misti, Workspace con nome, riconnessione tmux, Connection Notes, Git Browser e File Compare.
- **Assistente IA** — strumenti soggetti ad approvazione per Session, Dashboard, IT Ops e Custom Modules, oltre ad allegati, invio al terminale, MCP e Assistant Skills riutilizzabili.
- **Dashboard** — View selezionabili con Widget integrati o creati dall’IA, trascinabili e ridimensionabili. Include App Launcher, pannelli Connection in tempo reale, Notes, misuratori di utilizzo e strumenti pratici.
- **IT Ops** — topologia Site → Server Room → Rack (elevation, floor plan e vista 2.5D), inventario degli Host e scansioni di connettività, Task Script/Playbook riutilizzabili, Batch Run via SSH/WinRM/PsExec, IPAM, VLAN, Network Map, cronologia ed esportazioni PDF/CSV.
- **Screenshots** — cattura una regione, una finestra o l’intero desktop; salva in una libreria locale o negli appunti; ridimensiona/converti in batch e annota con ritaglio, forme, testo e mosaico.
- **Custom Modules** — installa pacchetti `.kkmod` isolati da Settings, controlla i permessi dichiarati, aggiungi destinazioni all’Activity Rail e gestisci aggiornamenti, rollback, spazio di archiviazione e disinstallazione. Il repository include integrazioni come Excalidraw, BentoPDF, OpenFlowKit e TiddlyWiki.
- **Install Helper (Windows)** — cerca, installa, aggiorna e disinstalla strumenti, applicazioni Web locali e servizi supportati senza uscire da KKTerm.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="Elevazioni dei Rack IT Ops con indicatori di stato dei dispositivi" width="720" />
</p>

## Rendilo tuo

Le View del Dashboard, le Connection del terminale, il visualizzatore di documenti e le viste di dettaglio IT Ops condividono lo stesso selettore di sfondi. Scegli colori e gradienti, immagini e video locali oppure **84 sfondi dinamici integrati**: oceani, meteo, scene WebGL, spazio, grafiche di rete e movimento astratto. Le scene nascoste o fuori schermo vengono messe in pausa e liberano le risorse di rendering. Completa la personalizzazione con temi colore, aspetto del terminale, font personalizzati e sfondi per Connection.

<p align="center">
  <img src="docs/assets/screenshots/backgrounds.png" alt="Selettore degli sfondi dinamici di KKTerm" width="720" />
</p>

## Guardalo in azione

<p align="center">
  <img src="docs/assets/demo.gif" alt="Demo di KKTerm" width="720" />
</p>

## Scarica KKTerm

Scarica l’[ultima versione](https://github.com/ryantsai/KKTerm/releases/latest) per Windows, macOS o Linux. Windows offre un installer e ZIP portatili x64/ARM64; estrai lo ZIP in una cartella locale scrivibile o su un’unità rimovibile, non da una condivisione di rete. Verifica il file `.sha256` adiacente prima di eseguire il pacchetto.

Per compilare dal codice sorgente, inizia da [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Contribuire, sostenere e documentazione

Contributi e segnalazioni di bug sono benvenuti. Consulta [`CONTRIBUTING.md`](CONTRIBUTING.md), il [manuale operativo](docs/manual/INDEX.md), l’[architettura](docs/ARCHITECTURE.md), la [guida Dashboard](docs/DASHBOARD.md), la [guida IT Ops](docs/ITOPS.md) e la [Custom Module Host API](docs/KKMOD_HOST_API_V2.md).

Se KKTerm ti è utile, puoi [sostenere il progetto](https://github.com/sponsors/ryantsai).

## Licenza

Il codice sorgente di KKTerm è rilasciato con MIT e Commons Clause. Crate vendorizzati, Custom Modules, font e pacchetti di icone restano soggetti alle rispettive licenze; consulta [`LICENSE`](LICENSE) e gli avvisi nelle loro directory.
