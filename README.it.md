<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>Un'unica finestra nativa Windows per terminali, SSH, SFTP, RDP/VNC e una dashboard — più un'IA che ti costruisce i tuoi piccoli strumenti su richiesta.</strong>
</p>

<p align="center">
  <em>Perché la tua barra delle applicazioni non dovrebbe sembrare una slot machine di Las Vegas.</em>
</p>

<p align="center">
  <sub>Prende il nome da <strong>乖乖 (Kuāi Kuāi)</strong>, lo snack verde al cocco che i sysadmin taiwanesi posano sui server perché si comportino bene. Speriamo che questa app si guadagni il suo posto sul rack.</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">Scarica l'ultima release di KKTerm</a></strong>
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
    <strong>Italiano</strong> ·
    <a href="README.pt-BR.md">Português (BR)</a> ·
    <a href="README.th.md">ไทย</a> ·
    <a href="README.id.md">Bahasa Indonesia</a> ·
    <a href="README.vi.md">Tiếng Việt</a>
  </sub>
</p>

---

## Il pitch in 45 secondi

KKTerm riunisce terminali locali, SSH/SFTP, FTP/FTPS, Telnet, connessioni seriali, RDP/VNC, pagine web integrate, file locali e documenti in un unico spazio di lavoro desktop. Le schede possono combinare diversi tipi di pannello, mantenendo insieme terminale, browser dei file e schermo remoto della stessa attività.

Funziona su Windows, macOS e Linux, salva i dati localmente e non usa telemetria. Include IA soggetta ad approvazione, widget Dashboard personalizzabili, Workspace, IT Ops e Install Helper per Windows.

---

## Perché «KKTerm»?

Entra in un qualunque data center taiwanese e guarda la cima dei rack. Oltre le fab di TSMC, le sale di controllo della metro di Taipei, le sale server della banca Cathay, gli apparati di commutazione di Chunghwa Telecom — scorgerai un sacchettino verde di 乖乖 (Kuāi Kuāi), uno snack di mais al gusto di cocco degli anni '60.

**KKTerm** è **Kuai Kuai Term** — uno spazio di amministrazione che aspira allo stesso lavoro dello snack: sedersi in silenzio accanto alle tue macchine importanti e aiutarle a comportarsi bene. Local-first. Niente telemetria. IA con approvazione. Quel genere di software noioso e affidabile.

Non siamo ancora riusciti a spedire un vero sacchetto di Kuai Kuai con l'installer. È roba da v2.

---

## Vederlo in movimento

<p align="center">
  <a href="https://github.com/ryantsai/KKTerm">
    <img
      src="docs/assets/demo.gif"
      alt="KKTerm demo"
      width="720"
    />
  </a>
</p>

<p align="center"><sub><em>(La GIF dimostrativa. Un'immagine vale più di mille punti elenco, e i punti elenco li abbiamo finiti.)</em></sub></p>

---

## Una finestra, ogni connessione

| Volevi… | KKTerm lo fa |
| --- | --- |
| Aprire una shell locale PowerShell / cmd / WSL | Terminali locali, affiancati |
| SSH verso un server | SSH con chiavi, agent, password, jump host e port forwarding |
| Sfogliare i file su quel server | SFTP dalla connessione SSH — doppio pannello, trascina per trasferire |
| FTP verso un NAS del 2012 | FTP / FTPS nello stesso file browser |
| Telnet verso ferraglia antica | Sì, c'è anche Telnet |
| Parlare con una porta seriale | Connessioni seriali — scegli porta COM e baud |
| Entrare in remoto su una macchina Windows | Il vero Desktop remoto Microsoft, integrato |
| VNC su un Pi | VNC, renderizzato direttamente nello spazio di lavoro |
| Aprire l'interfaccia web del router | Una scheda di browser integrata con login salvati |
| Sfogliare il tuo disco | Un pannello File Explorer locale, lo stesso doppio pannello di SFTP |
| Aprire un log, CSV, immagine o PDF | Un visualizzatore Document integrato con una vera modalità log a inseguimento (tail) |
| Tenere d'occhio la CPU dell'host | Una barra di stato dal vivo e una dashboard che costruisci tu |

La stessa app. La stessa finestra. Le stesse scorciatoie. Lo stesso tema, si spera non sanguinoso per gli occhi.

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="Un singolo Tab con SSH, SFTP e una UI web integrata affiancati" width="720" />
</p>

---

## Perché la gente lo tiene aperto tutto il giorno

### Download piccolo, avvio fulmineo

KKTerm è costruito per sembrare un'utilità, non una piattaforma. Le build desktop attuali pesano meno di 20 MB, si installano in fretta e si avviano abbastanza rapidamente da non far sembrare l'apertura del tuo spazio di amministrazione l'avvio di un secondo sistema operativo.

### Griglie multi-pannello, mescolate come lavori

Un Tab può contenere una griglia di Panes, e quei Panes non devono essere dello stesso tipo. Metti SSH accanto a SFTP, una PowerShell locale sotto una RDP Session, VNC accanto alla UI web del router, o un file browser vicino al terminale che sta spostando i file.

<p align="center">
  <img src="docs/assets/screenshots/multi-pane.png" alt="Un Tab diviso in quattro pannelli di tipi di connessione diversi" width="720" />
</p>

### Un assistente IA che comanda i tuoi terminali per te

Gran parte delle demo «IA nel terminale» si ferma alla chat. L'assistente di KKTerm lavora *dentro* la tua sessione: gli passi il contesto da ciò che è già a schermo, e agisce sulle macchine a cui sei connesso — con un umano nel ciclo di approvazione.

<p align="center">
  <img src="docs/assets/screenshots/ai-assistant.png" alt="Il pannello dell'assistente IA con gli interruttori di accesso ai tool e di modalità di approvazione" width="720" />
</p>

### Una dashboard che non finge di essere Grafana

La Dashboard è una griglia di widget che trascini e ridimensioni. Non è per l'osservabilità su scala petabyte — è per «voglio un pulsante che lanci le mie cinque app preferite e un pannello che mostra l'uptime del mio host SSH, *accanto* alla mia chat».

Le View della Dashboard offrono 45 sfondi animati integrati in KKTerm. Gli otto più recenti sono scene WebGL procedurali: `heroGeometric`, `ditherPrismHero`, `webglLiquid`, `silkAurora`, `closingPlasma`, `animatedGradient`, `prismGradient` e `liquidChrome`. Lo stesso selettore di sfondi è disponibile per le Connection del terminale, il Document viewer e le viste di dettaglio di IT Ops; le scene nascoste o fuori dallo schermo interrompono il rendering e rilasciano le risorse WebGL.

<p align="center">
  <img src="docs/assets/screenshots/ai-widgets.png" alt="Una griglia di dashboard piena di widget creati dall'IA" width="720" />
</p>

### IT Ops per siti, host e attività ripetibili

Il Modulo **IT Ops** raggruppa le connessioni in siti, rappresenta sale server e rack, cataloga gli host ed esegue attività riutilizzabili sulle macchine selezionate. Le esecuzioni batch conservano i risultati per host, mentre le automazioni collegano eventi e condizioni a notifiche, webhook o attività.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="La vista frontale della sala server di IT Ops con sei rack popolati e indicatori di stato degli host" width="720" />
</p>

### Acquisisci, organizza e annota schermate

Il Modulo **Screenshots** acquisisce un’area, una finestra o l’intero desktop in una raccolta locale, negli appunti oppure in entrambi. Puoi ordinare e raggruppare le schermate, ridimensionarle o convertirle in gruppo e aprire qualsiasi immagine nell’editor integrato per ritagliare, disegnare a mano libera, aggiungere frecce, forme e testo oppure oscurare dettagli con l’effetto mosaico. Le scorciatoie globali e il menu dell’area di notifica rendono l’acquisizione sempre immediata.

<p align="center">
  <img src="docs/assets/screenshots/screenshots-module.png" alt="Il Modulo Screenshots con i controlli di acquisizione e una raccolta di anteprime" width="720" />
</p>

### Tieni vivi i tuoi agenti IA

Questa è la seconda funzione di cui la gente s'innamora. I terminali SSH di KKTerm possono catapultarti direttamente in una **sessione tmux con nome** sull'host remoto che sopravvive alla riconnessione.

<p align="center">
  <img src="docs/assets/screenshots/tmux-reattach.png" alt="Un pannello SSH che si riaggancia a una sessione tmux con nome dopo una riconnessione" width="720" />
</p>

### Tieni separati i tuoi mondi con i Workspace

L'homelab, il lavoro e i server di quel cliente non appartengono alla stessa lista. I **Workspace** sono contenitori di Connections con nome e isolati tra cui commuti dall'Activity Rail. Commutare riassegna l'ambito solo all'albero delle connessioni — le tue Sessions aperte, la Dashboard e le impostazioni restano dove sono — quindi cambiare contesto costa un clic, non un riavvio.

<p align="center">
  <img src="docs/assets/screenshots/workspaces.png" alt="Il selettore di workspace nell'activity rail" width="720" />
</p>

### Vestilo come vuoi: temi di colore

Gli sfondi sono la parte divertente; i **temi di colore** sono quello che fissi davvero tutto il giorno. KKTerm porta **ventisei** schemi di colore che ridisegnano tutta la cornice dell'app — Activity Rail, albero delle connessioni, schede, finestre — con una mini-anteprima dal vivo di ciascuno in Impostazioni ▸ Aspetto.

<p align="center">
  <img src="docs/assets/screenshots/color-themes.png" alt="La griglia degli schemi di colore in Impostazioni con anteprime dal vivo" width="720" />
</p>

### Install Helper (solo Windows)

Preparare una macchina Windows nuova per lo sviluppo di solito significa dieci schede del browser e un sacco di «avanti, avanti, fine». L'**Install Helper** è un catalogo integrato che trova, installa, aggiorna e disinstalla i tool che altrimenti inseguiresti a mano — senza uscire da KKTerm.

<p align="center">
  <img src="docs/assets/screenshots/install-helper.png" alt="Il catalogo Install Helper con i tool installati e disponibili" width="720" />
</p>

---

## Cosa KKTerm non è

Una lista breve, perché l'onestà conquista fiducia:

- **Non è un prodotto cloud.** Niente sync, niente account di team, niente piano SaaS. Se mai vedi una finestra «Accedi a KKTerm», qualcosa è andato catastroficamente storto.
- **Non finge che tutti i sistemi operativi siano identici.** KKTerm pubblica build per Windows, macOS e Linux, mantenendo chiare le funzioni specifiche di ogni piattaforma.
- **Non è un agente IA autonomo.** L'assistente propone; l'umano dispone. `Allow All` è una scelta che fai tu, non un default.
- **Non è un sostituto di Grafana / Datadog.** La Dashboard è per superfici di controllo personali, non per l'osservabilità di 10.000 host.
- **Non è un IDE per Kubernetes.** È uno spazio di amministrazione incentrato sul terminale. Per favore non chiedergli di renderizzare un chart Helm.

Se uno di questi punti *era* un dealbreaker — giusto così, ci vediamo in v2.

---

## Ottieni KKTerm

**[Scarica l'ultima release di KKTerm](https://github.com/ryantsai/KKTerm/releases/latest)**, scegli il pacchetto per la tua piattaforma e aprilo. Gli installer per Windows al momento sono **non firmati** — la firma delle release è nella roadmap, quindi fino ad allora il tuo antivirus potrebbe guardarti storto. È normale.

Vuoi compilare dai sorgenti o contribuire? Tutto ciò che serve è in [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Roadmap (versione breve)

- Rifinitura delle release multipiattaforma
- Rifinitura della firma delle release
- Trasferimento file più potente (ripresa, sync di cartelle, archivia/estrai)
- Condivisione di appunti e dispositivi più ricca per il Desktop remoto
- Più widget da dashboard integrati
- Più funzionalità di automazione IT Ops

Versione completa e aggiornata di frequente: [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Contribuire

Ci farebbe piacere una mano. Davvero. Anche le piccole cose contano.

Setup completo, struttura del progetto e checklist per le PR sono in [`CONTRIBUTING.md`](CONTRIBUTING.md). Cerchi un punto d'ingresso? Filtra le issue aperte per [`good first issue`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) o [`help wanted`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22).

---

## Documenti del progetto

- [Contesto di prodotto](CONTEXT.md) — il linguaggio di dominio da rispettare
- [Architettura](docs/ARCHITECTURE.md) — mappa dei moduli, dove mettere il nuovo codice
- [Manuale utente](docs/manual/INDEX.md) — un giro funzione per funzione
- [Roadmap](docs/ROADMAP.md)
- [Architettura della Dashboard](docs/DASHBOARD.md)
- [Server MCP integrato](docs/MCP.md)
- [Guida ai provider IA](docs/AI_PROVIDERS.md)

---

## Cronologia delle stelle

<a href="https://www.star-history.com/#ryantsai/KKTerm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=ryantsai/KKTerm&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=ryantsai/KKTerm&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=ryantsai/KKTerm&type=Date" />
  </picture>
</a>

---

## Licenza

MIT. Vedi [LICENSE](LICENSE). Usalo, forkalo, spediscilo, mettilo in un homelab che nessun altro troverà — questo è l'accordo.
