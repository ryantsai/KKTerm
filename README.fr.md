<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>Un espace de travail de bureau multiplateforme pour les terminaux, SSH/SFTP, RDP/VNC, les fichiers, le Web, l’IT Ops et un assistant IA soumis à approbation.</strong>
</p>

<p align="center">
  <em>Parce que votre barre des tâches ne devrait pas ressembler à une machine à sous de Las Vegas.</em>
</p>

<p align="center">
  <sub>Le nom vient de <strong>乖乖 (Kuāi Kuāi)</strong>, l’en-cas vert à la noix de coco que les administrateurs taïwanais posent sur leurs serveurs pour qu’ils se tiennent bien.</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">Télécharger la dernière version de KKTerm</a></strong>
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
    <img src="https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-blue?style=for-the-badge" alt="Licence MIT avec Commons Clause" />
  </a>
  <a href="https://github.com/sponsors/ryantsai">
    <img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Soutenir KKTerm sur GitHub" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="Bureau multiplateforme" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="Local d’abord, sans télémétrie" />
  <br />
  <sub>
    <a href="README.md">English</a> ·
    <a href="README.zh-TW.md">繁體中文</a> ·
    <a href="README.zh-CN.md">简体中文</a> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="README.ko.md">한국어</a> ·
    <strong>Français</strong> ·
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

## Pourquoi « KKTerm » ?

KKTerm signifie **Kuai Kuai Term** — un clin d’œil au 乖乖 vert que les administrateurs taïwanais posent sur leurs serveurs pour que leurs machines restent calmes, fiables et sages.

## Une fenêtre, toutes les connexions

KKTerm réunit les shells locaux, SSH/SFTP, FTP/FTPS, Telnet, les connexions série, RDP/VNC, les connexions URL, l’explorateur de fichiers local et le lecteur de documents dans un seul espace de travail. Un Tab peut mélanger plusieurs types de Pane : le terminal, les fichiers, une interface Web et un écran distant restent ainsi ensemble.

| Besoin | KKTerm |
| --- | --- |
| Shells locaux | PowerShell, cmd et WSL |
| Accès distant | SSH, Telnet, série, RDP et VNC |
| Fichiers et Web | SFTP, FTP/FTPS, fichiers locaux et connexions URL intégrées |
| Documents | Journaux avec suivi en continu, texte, CSV, images et PDF |

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="Panes SSH, SFTP, terminal, URL et RDP mélangés dans un même Tab KKTerm" width="720" />
</p>

## Tout le travail autour du terminal

- **Workspace** — Tabs et Panes mélangés, Workspaces nommés, réattachement tmux, Connection Notes, Git Browser et File Compare.
- **Assistant IA** — outils soumis à approbation pour les Sessions, le Dashboard, l’IT Ops et les Custom Modules, avec pièces jointes, envoi vers le terminal, MCP et Assistant Skills réutilisables.
- **Dashboard** — Views commutables et Widgets intégrés ou créés par l’IA, déplaçables et redimensionnables. App Launcher, panneaux de Connections en direct, Notes, compteurs d’utilisation et outils pratiques sont inclus.
- **IT Ops** — topologie Site → Server Room → Rack (elevation, floor plan et vue 2.5D), inventaire des Hosts et scans de connectivité, Tasks Script/Playbook réutilisables, Batch Runs via SSH/WinRM/PsExec, IPAM, VLAN, Network Maps, historique et exports PDF/CSV.
- **Screenshots** — capturez une zone, une fenêtre ou le bureau entier, enregistrez dans une bibliothèque locale ou le presse-papiers, redimensionnez/convertissez par lots et annotez avec recadrage, formes, texte et mosaïque.
- **Custom Modules** — installez depuis Settings des paquets `.kkmod` isolés, examinez leurs permissions déclarées, ajoutez leurs destinations à l’Activity Rail et gérez mise à jour, retour arrière, stockage et désinstallation. Le dépôt contient notamment les intégrations Excalidraw, BentoPDF, OpenFlowKit et TiddlyWiki.
- **Install Helper (Windows)** — recherchez, installez, mettez à jour et désinstallez des outils, ainsi que des applications Web et services locaux pris en charge, sans quitter KKTerm.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="Élévations de racks IT Ops dans une Server Room avec indicateurs d’état" width="720" />
</p>

## Personnalisez votre espace

Les Views du Dashboard, les Connections terminal, le lecteur de documents et les vues de détail IT Ops partagent le même sélecteur d’arrière-plan. Choisissez des aplats ou dégradés, vos images et vidéos locales, ou **84 arrière-plans dynamiques intégrés** : océans, météo, scènes WebGL, espace, graphiques réseau et animations abstraites. Les scènes masquées ou hors écran se mettent en pause et libèrent leurs ressources de rendu. Thèmes de couleurs, apparence du terminal, polices personnalisées et arrière-plans par Connection complètent la personnalisation.

<p align="center">
  <img src="docs/assets/screenshots/backgrounds.png" alt="Sélecteur d’arrière-plans dynamiques de KKTerm" width="720" />
</p>

## Voir KKTerm en action

<p align="center">
  <img src="docs/assets/demo.gif" alt="Démonstration de KKTerm" width="720" />
</p>

## Obtenir KKTerm

Téléchargez la [dernière version](https://github.com/ryantsai/KKTerm/releases/latest) pour Windows, macOS ou Linux. Windows propose un installateur et des ZIP portables x64/ARM64 ; extrayez un ZIP portable dans un dossier local accessible en écriture ou sur un disque amovible, jamais depuis un partage réseau. Vérifiez le fichier `.sha256` adjacent avant de lancer le paquet.

Pour compiler depuis les sources, commencez par [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Contribuer, soutenir et consulter la documentation

Les contributions et rapports de bugs sont les bienvenus. Consultez [`CONTRIBUTING.md`](CONTRIBUTING.md), puis le [manuel d’utilisation](docs/manual/INDEX.md), l’[architecture](docs/ARCHITECTURE.md), le [guide Dashboard](docs/DASHBOARD.md), le [guide IT Ops](docs/ITOPS.md) et l’[API hôte des Custom Modules](docs/KKMOD_HOST_API_V2.md).

Vous pouvez [soutenir le projet](https://github.com/sponsors/ryantsai) si KKTerm vous est utile.

## Licence

Le code source de KKTerm est sous MIT avec Commons Clause. Les crates vendues, Custom Modules, polices et packs d’icônes restent soumis à leurs propres licences ; voir [`LICENSE`](LICENSE) et les fichiers de notices de leurs répertoires.
