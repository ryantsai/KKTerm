<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>Un espacio de trabajo de escritorio multiplataforma para terminales, SSH/SFTP, RDP/VNC, archivos, web, IT Ops y un asistente de IA con aprobación.</strong>
</p>

<p align="center">
  <em>Porque tu barra de tareas no debería parecer una máquina tragamonedas de Las Vegas.</em>
</p>

<p align="center">
  <sub>El nombre viene de <strong>乖乖 (Kuāi Kuāi)</strong>, el aperitivo verde de coco que los administradores taiwaneses colocan sobre los servidores para que se porten bien.</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">Descargar la última versión de KKTerm</a></strong>
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
    <img src="https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-blue?style=for-the-badge" alt="Licencia MIT con Commons Clause" />
  </a>
  <a href="https://buymeacoffee.com/ryantsai">
    <img src="https://img.shields.io/badge/Buy_Me_a_Coffee-%E2%98%95-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Invítame a un café" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="Escritorio multiplataforma" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="Local primero, sin telemetría" />
  <br />
  <sub>
    <a href="README.md">English</a> ·
    <a href="README.zh-TW.md">繁體中文</a> ·
    <a href="README.zh-CN.md">简体中文</a> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="README.ko.md">한국어</a> ·
    <a href="README.fr.md">Français</a> ·
    <a href="README.de.md">Deutsch</a> ·
    <strong>Español</strong> ·
    <a href="README.es-MX.md">Español (MX)</a> ·
    <a href="README.it.md">Italiano</a> ·
    <a href="README.pt-BR.md">Português (BR)</a> ·
    <a href="README.th.md">ไทย</a> ·
    <a href="README.id.md">Bahasa Indonesia</a> ·
    <a href="README.vi.md">Tiếng Việt</a>
  </sub>
</p>

---

## ¿Por qué «KKTerm»?

KKTerm significa **Kuai Kuai Term**: un guiño al 乖乖 verde que los administradores taiwaneses colocan sobre los servidores para que las máquinas importantes sigan tranquilas, confiables y bien portadas.

## Una ventana, todas las conexiones

KKTerm reúne shells locales, SSH/SFTP, FTP/FTPS, Telnet, conexiones serie, RDP/VNC, conexiones URL, el explorador de archivos local y el visor de documentos en un solo espacio de trabajo. Un Tab puede mezclar distintos tipos de Pane para mantener juntos el terminal, el explorador de archivos, la interfaz web y la pantalla remota de una misma tarea.

| Necesitas | KKTerm |
| --- | --- |
| Shells locales | PowerShell, cmd y WSL |
| Acceso remoto | SSH, Telnet, serie, RDP y VNC |
| Archivos y web | SFTP, FTP/FTPS, archivos locales y conexiones URL integradas |
| Documentos | Logs con seguimiento continuo, texto, CSV, imágenes y PDF |

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="Panes SSH, SFTP, terminal, URL y RDP mezclados en un Tab de KKTerm" width="720" />
</p>

## Todo lo que rodea al terminal

- **Workspace** — Tabs y Panes mezclados, Workspaces con nombre, reconexión de tmux, Connection Notes, Git Browser y File Compare.
- **Asistente de IA** — herramientas con aprobación para Sessions, Dashboard, IT Ops y Custom Modules, además de archivos adjuntos, envío al terminal, MCP y Assistant Skills reutilizables.
- **Dashboard** — Views intercambiables con Widgets integrados o creados por IA, arrastrables y redimensionables. Incluye App Launcher, paneles de Connection en vivo, Notes, medidores de uso y herramientas prácticas.
- **IT Ops** — topología Site → Server Room → Rack (elevation, floor plan y vista 2.5D), inventario de Hosts y escaneos de conectividad, Tasks Script/Playbook reutilizables, Batch Runs por SSH/WinRM/PsExec, IPAM, VLAN, Network Maps, historial y exportaciones PDF/CSV.
- **Screenshots** — captura una región, ventana o todo el escritorio; guarda en una biblioteca local o el portapapeles; cambia tamaño y formato por lotes; y anota con recorte, formas, texto y mosaico.
- **Custom Modules** — instala paquetes `.kkmod` aislados desde Settings, revisa sus permisos declarados, añade destinos al Activity Rail y administra actualizaciones, reversión, almacenamiento y desinstalación. El repositorio incluye integraciones como Excalidraw, BentoPDF, OpenFlowKit y TiddlyWiki.
- **Install Helper (Windows)** — busca, instala, actualiza y desinstala herramientas, aplicaciones web locales y servicios compatibles sin salir de KKTerm.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="Elevaciones de racks de IT Ops con indicadores de estado de los dispositivos" width="720" />
</p>

## Hazlo tuyo

Las Views del Dashboard, las Connections del terminal, el visor de documentos y las vistas de detalle de IT Ops comparten el mismo selector de fondos. Elige colores y degradados, imágenes y videos locales, o **84 fondos dinámicos integrados** con océanos, clima, escenas WebGL, espacio, gráficos de red y movimiento abstracto. Las escenas ocultas o fuera de pantalla se pausan y liberan sus recursos de renderizado. También puedes ajustar temas de color, apariencia del terminal, fuentes personalizadas y fondos por Connection.

<p align="center">
  <img src="docs/assets/screenshots/backgrounds.png" alt="Selector de fondos dinámicos de KKTerm" width="720" />
</p>

## Míralo en acción

<p align="center">
  <img src="docs/assets/demo.gif" alt="Demo de KKTerm" width="720" />
</p>

## Consigue KKTerm

Descarga la [última versión](https://github.com/ryantsai/KKTerm/releases/latest) para Windows, macOS o Linux. Windows ofrece un instalador y ZIP portables para x64/ARM64; extrae el ZIP en una carpeta local con permisos de escritura o en una unidad extraíble, no en una ubicación compartida de red. Verifica el archivo `.sha256` que lo acompaña antes de ejecutar el paquete.

Para compilar desde el código fuente, empieza por [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Contribuir, apoyar y consultar la documentación

Las contribuciones y los reportes de errores son bienvenidos. Consulta [`CONTRIBUTING.md`](CONTRIBUTING.md), el [manual de operaciones](docs/manual/INDEX.md), la [arquitectura](docs/ARCHITECTURE.md), la [guía de Dashboard](docs/DASHBOARD.md), la [guía de IT Ops](docs/ITOPS.md) y la [API de host de Custom Modules](docs/KKMOD_HOST_API_V2.md).

Si KKTerm te resulta útil, puedes [invitarme a un café](https://buymeacoffee.com/ryantsai).

## Licencia

El código fuente de KKTerm usa MIT con Commons Clause. Los crates vendorizados, Custom Modules, fuentes y paquetes de iconos conservan sus propias licencias; consulta [`LICENSE`](LICENSE) y los avisos de sus directorios.
