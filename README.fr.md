<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>Une seule fenêtre native de bureau pour les terminaux, le SSH, le SFTP, le RDP/VNC et un tableau de bord — plus une IA qui fabrique vos petits outils sur demande.</strong>
</p>

<p align="center">
  <em>Parce que votre barre des tâches ne devrait pas ressembler à une machine à sous de Las Vegas.</em>
</p>

<p align="center">
  <sub>Nommé d'après <strong>乖乖 (Kuāi Kuāi)</strong>, l'en-cas vert à la noix de coco que les administrateurs taïwanais posent sur leurs serveurs pour qu'ils se tiennent bien. On espère que cette appli gagnera sa place sur le rack.</sub>
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

## L'argumentaire en 45 secondes

KKTerm réunit les terminaux locaux, SSH/SFTP, FTP/FTPS, Telnet, les connexions série, RDP/VNC, les pages web intégrées, les fichiers locaux et les documents dans un seul espace de travail. Un onglet peut mélanger plusieurs types de volets afin de garder ensemble le terminal, le navigateur de fichiers et l’écran distant d’une même tâche.

Il fonctionne sous Windows, macOS et Linux, stocke les données localement et n’utilise aucune télémétrie. IA soumise à approbation, widgets de Dashboard personnalisables, Workspaces, IT Ops et Install Helper pour Windows sont intégrés.

---

## Pourquoi « KKTerm » ?

Entrez dans n'importe quel data center taïwanais et regardez le haut des racks. Au-delà des fabs de TSMC, des salles de contrôle du métro de Taipei, des salles serveurs de la banque Cathay, des équipements de commutation de Chunghwa Telecom — vous repérerez un petit sachet vert de 乖乖 (Kuāi Kuāi), un en-cas au maïs parfumé à la noix de coco des années 1960.

**KKTerm**, c'est **Kuai Kuai Term** — un espace d'administration qui vise le même rôle que l'en-cas : s'asseoir tranquillement à côté de vos machines importantes et les aider à bien se tenir. Local d'abord. Pas de télémétrie. IA sous validation. Le genre de logiciel ennuyeux et fiable.

On n'a pas encore réussi à livrer un vrai sachet de Kuai Kuai avec l'installateur. C'est un point pour la v2.

---

## Voir ça bouger

<p align="center">
  <a href="https://github.com/ryantsai/KKTerm">
    <img
      src="docs/assets/demo.gif"
      alt="KKTerm demo"
      width="720"
    />
  </a>
</p>

<p align="center"><sub><em>(Le GIF de démo. Une image vaut mille puces, et on est à court de puces.)</em></sub></p>

---

## Une fenêtre, chaque connexion

| Ce que vous vouliez… | Ce que fait KKTerm |
| --- | --- |
| Ouvrir un shell local PowerShell / cmd / WSL | Des terminaux locaux, côte à côte |
| SSH vers un serveur | SSH avec clés, agent, mots de passe, hôtes de rebond et redirection de ports |
| Parcourir les fichiers de ce serveur | SFTP depuis la connexion SSH — double volet, glissez pour transférer |
| FTP vers un NAS de 2012 | FTP / FTPS dans le même explorateur de fichiers |
| Telnet vers du matériel antique | Oui, Telnet est là aussi |
| Parler à un port série | Connexions série — choisissez un port COM et un débit |
| Prendre la main sur une machine Windows | Le vrai Bureau à distance Microsoft, intégré |
| VNC vers un Pi | VNC, rendu directement dans l'espace de travail |
| Ouvrir l'interface web du routeur | Un onglet de navigateur intégré avec identifiants enregistrés |
| Parcourir votre propre disque | Un volet File Explorer local, le même double-volet que SFTP |
| Ouvrir un log, un CSV, une image ou un PDF | Une visionneuse Document intégrée avec un vrai mode log en suivi (tail) |
| Surveiller le CPU de l'hôte | Une barre d'état en direct et un tableau de bord à bâtir vous-même |

La même appli. La même fenêtre. Les mêmes raccourcis. Le même thème, qu'on espère non agressif pour les yeux.

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="Un seul Tab contenant SSH, SFTP et une interface web intégrée côte à côte" width="720" />
</p>

---

## Pourquoi les gens le laissent ouvert toute la journée

### Un petit téléchargement, un lancement éclair

KKTerm est conçu pour se comporter comme un utilitaire, pas comme une plateforme. Les builds desktop actuels pèsent moins de 20 Mo, s'installent vite et se lancent assez rapidement pour que l'ouverture de votre espace d'administration ne ressemble pas au démarrage d'un deuxième système d'exploitation.

### Des grilles multi-volets, mélangées comme vous travaillez

Un Tab peut contenir une grille de Panes, et ces Panes n'ont pas besoin d'être du même type. Mettez SSH à côté de SFTP, un PowerShell local sous une RDP Session, VNC à côté de l'interface web du routeur, ou un navigateur de fichiers près du terminal qui déplace les fichiers.

<p align="center">
  <img src="docs/assets/screenshots/multi-pane.png" alt="Un Tab divisé en quatre volets de types de connexion différents" width="720" />
</p>

### Un assistant IA qui pilote vos terminaux pour vous

La plupart des démos d'« IA dans le terminal » s'arrêtent au chat. L'assistant de KKTerm travaille *à l'intérieur* de votre session : vous lui donnez du contexte à partir de ce qui est déjà à l'écran, et il agit sur les machines auxquelles vous êtes connecté — avec un humain dans la boucle d'approbation.

<p align="center">
  <img src="docs/assets/screenshots/ai-assistant.png" alt="Le panneau de l'assistant IA avec les bascules d'accès aux outils et de mode d'approbation" width="720" />
</p>

### Un tableau de bord qui ne se prend pas pour Grafana

Le Dashboard est une grille de widgets que l'on glisse et redimensionne. Ce n'est pas pour l'observabilité à l'échelle du pétaoctet — c'est pour « je veux un bouton pour lancer mes cinq applis préférées et un panneau montrant la disponibilité de mon hôte SSH, *à côté* de mon chat ».

Les Views du Dashboard proposent 45 arrière-plans animés intégrés à KKTerm. Les huit nouveautés sont des scènes WebGL procédurales : `heroGeometric`, `ditherPrismHero`, `webglLiquid`, `silkAurora`, `closingPlasma`, `animatedGradient`, `prismGradient` et `liquidChrome`. Le même sélecteur d’arrière-plan est disponible pour les Connections de terminal, le Document viewer et les vues détaillées d’IT Ops ; une scène masquée ou hors écran cesse son rendu et libère ses ressources WebGL.

<p align="center">
  <img src="docs/assets/screenshots/ai-widgets.png" alt="Une grille de tableau de bord remplie de widgets créés par l'IA" width="720" />
</p>

### IT Ops pour les sites, les hôtes et les tâches répétables

Le Module **IT Ops** regroupe les connexions par sites, représente les salles serveurs et les racks, inventorie les hôtes et exécute des tâches réutilisables sur les machines choisies. Les exécutions par lots conservent les résultats par hôte ; les automatisations relient déclencheurs et conditions aux notifications, webhooks ou tâches.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="La vue en élévation de la salle serveurs IT Ops avec six racks équipés et des indicateurs d’état des hôtes" width="720" />
</p>

### Capturer, classer et annoter des captures d’écran

Le Module **Screenshots** capture une zone, une fenêtre ou l’ensemble du bureau dans une bibliothèque locale, dans le presse-papiers, ou dans les deux. Triez et regroupez les captures, redimensionnez-les ou convertissez-les par lot, puis ouvrez n’importe quelle image dans l’éditeur intégré pour la recadrer, dessiner à main levée, ajouter des flèches, des formes ou du texte, et masquer des éléments en mosaïque. Les raccourcis globaux et le menu de la zone de notification gardent la capture à portée de touche.

<p align="center">
  <img src="docs/assets/screenshots/screenshots-module.png" alt="Le Module Screenshots avec ses commandes de capture et sa bibliothèque de miniatures" width="720" />
</p>

### Garder vos agents IA en vie

C'est la deuxième fonction dont les gens tombent amoureux. Les terminaux SSH de KKTerm peuvent vous déposer directement dans une **session tmux nommée** sur l'hôte distant, qui survit à la reconnexion .

<p align="center">
  <img src="docs/assets/screenshots/tmux-reattach.png" alt="Un panneau SSH se rattachant à une session tmux nommée après une reconnexion" width="720" />
</p>

### Séparer vos mondes avec les espaces de travail

Le homelab, le boulot et les serveurs de ce client-là n'ont pas leur place dans la même liste. Les **espaces de travail (Workspaces)** sont des conteneurs de Connections nommés et isolés que vous commutez depuis l'Activity Rail. Commuter ne re-cadre que l'arbre des connexions — vos Sessions ouvertes, le Dashboard et les réglages restent en place — donc changer de contexte coûte un clic, pas un redémarrage.

<p align="center">
  <img src="docs/assets/screenshots/workspaces.png" alt="Le sélecteur d'espace de travail dans l'activity rail" width="720" />
</p>

### Habillez-le : thèmes de couleurs

Les fonds, c'est le côté fun ; les **thèmes de couleurs**, c'est ce que vous fixez vraiment toute la journée. KKTerm propose **vingt-six** schémas de couleurs qui restylent tout l'habillage de l'appli — Activity Rail, arbre des connexions, onglets, boîtes de dialogue — avec un mini-aperçu en direct de chacun sous Réglages ▸ Apparence .

<p align="center">
  <img src="docs/assets/screenshots/color-themes.png" alt="La grille des schémas de couleurs dans les Réglages avec aperçus en direct" width="720" />
</p>

### Install Helper (Windows uniquement)

Préparer une machine Windows neuve pour le dev, c'est d'habitude dix onglets de navigateur et beaucoup de « suivant, suivant, terminer ». L'**Install Helper** est un catalogue intégré qui trouve, installe, met à jour et désinstalle les outils que vous traqueriez sinon à la main — sans quitter KKTerm .

<p align="center">
  <img src="docs/assets/screenshots/install-helper.png" alt="Le catalogue Install Helper avec les outils installés et disponibles" width="720" />
</p>

---

## Ce que KKTerm n'est pas

Une courte liste, parce que l'honnêteté inspire confiance :

- **Pas un produit cloud.** Pas de synchro, pas de comptes d'équipe, pas d'offre SaaS. Si vous voyez un jour une boîte « Se connecter à KKTerm », c'est qu'un truc a catastrophiquement mal tourné.
- **Ne prétend pas que tous les OS sont identiques.** KKTerm publie des builds Windows, macOS et Linux, tout en gardant les fonctions propres à chaque plateforme clairement indiquées.
- **Pas un agent IA autonome.** L'assistant propose ; l'humain dispose. `Allow All` est un choix que vous faites, pas un défaut.
- **Pas un remplaçant de Grafana / Datadog.** Le Dashboard est pour des surfaces de contrôle personnelles, pas pour l'observabilité de 10 000 hôtes.
- **Pas un IDE Kubernetes.** C'est un espace d'administration centré terminal. Ne lui demandez pas de rendre un chart Helm.

Si l'un de ces points *était* rédhibitoire — très bien, on se voit en v2.

---

## Obtenir KKTerm

**[Téléchargez la dernière version de KKTerm](https://github.com/ryantsai/KKTerm/releases/latest)**, choisissez le paquet correspondant à votre plateforme et ouvrez-le. Les installateurs Windows sont pour l'instant **non signés** — la signature de version est sur la feuille de route, donc d'ici là votre antivirus pourrait vous jeter un regard sévère. C'est normal.

Envie de compiler depuis les sources ou de contribuer ? Tout ce qu'il vous faut est dans [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Feuille de route (version courte)

- Finition des versions multiplateformes
- Finition de la signature des versions
- Transferts de fichiers plus puissants (reprise, synchro de dossiers, archive/extraction)
- Partage presse-papiers et périphériques plus riche pour le Bureau à distance
- Plus de widgets de tableau de bord intégrés
- Plus de fonctions d'automatisation IT Ops

Version complète et fréquemment mise à jour : [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Contribuer

On adorerait un coup de main. Vraiment. Même les petites choses comptent .

L'installation complète, la structure du projet et la checklist de PR sont dans [`CONTRIBUTING.md`](CONTRIBUTING.md). Vous cherchez un point d'entrée ? Filtrez les issues ouvertes par [`good first issue`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) ou [`help wanted`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22).

---

## Docs du projet

- [Contexte produit](CONTEXT.md) — le langage métier à respecter
- [Architecture](docs/ARCHITECTURE.md) — carte des modules, où mettre le nouveau code
- [Manuel utilisateur](docs/manual/INDEX.md) — un tour fonctionnalité par fonctionnalité
- [Feuille de route](docs/ROADMAP.md)
- [Architecture du Dashboard](docs/DASHBOARD.md)
- [Serveur MCP intégré](docs/MCP.md)
- [Guide des fournisseurs IA](docs/AI_PROVIDERS.md)

---

## Licence

MIT. Voir [LICENSE](LICENSE). Utilisez-le, forkez-le, livrez-le, mettez-le dans un homelab que personne d'autre ne trouvera — c'est le marché.
