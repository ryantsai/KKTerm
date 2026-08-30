<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>Um espaço de trabalho desktop multiplataforma para terminais, SSH/SFTP, RDP/VNC, arquivos, web, IT Ops e um assistente de IA com aprovação.</strong>
</p>

<p align="center">
  <em>Porque sua barra de tarefas não precisa parecer uma máquina caça-níqueis de Las Vegas.</em>
</p>

<p align="center">
  <sub>O nome vem do <strong>乖乖 (Kuāi Kuāi)</strong>, o salgadinho verde de coco que administradores de sistemas taiwaneses colocam sobre os servidores para que eles se comportem.</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">Baixe a versão mais recente do KKTerm</a></strong>
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
    <img src="https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-blue?style=for-the-badge" alt="Licença MIT com Commons Clause" />
  </a>
  <a href="https://buymeacoffee.com/ryantsai">
    <img src="https://img.shields.io/badge/Buy_Me_a_Coffee-%E2%98%95-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Pague-me um café" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="Desktop multiplataforma" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="Local-first, sem telemetria" />
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
    <strong>Português (BR)</strong> ·
    <a href="README.th.md">ไทย</a> ·
    <a href="README.id.md">Bahasa Indonesia</a> ·
    <a href="README.vi.md">Tiếng Việt</a>
  </sub>
</p>

---

## Por que "KKTerm"?

KKTerm significa **Kuai Kuai Term** — uma referência ao 乖乖 verde que administradores taiwaneses colocam sobre os servidores para que as máquinas importantes continuem silenciosas, confiáveis e bem-comportadas.

## Uma janela, todas as conexões

O KKTerm reúne shells locais, SSH/SFTP, FTP/FTPS, Telnet, conexões seriais, RDP/VNC, conexões URL, o Explorador de Arquivos local e o visualizador de documentos em um único espaço de trabalho. Um Tab pode misturar tipos de Pane, mantendo juntos o terminal, o navegador de arquivos, a interface web e a tela remota da mesma tarefa.

| Você precisa de | O KKTerm oferece |
| --- | --- |
| Shells locais | PowerShell, cmd e WSL |
| Acesso remoto | SSH, Telnet, serial, RDP e VNC |
| Arquivos e web | SFTP, FTP/FTPS, arquivos locais e conexões URL integradas |
| Documentos | Logs com acompanhamento contínuo, texto, CSV, imagens e PDFs |

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="Panes de SSH, SFTP, terminal, URL e RDP misturados em um Tab do KKTerm" width="720" />
</p>

## Tudo ao redor do terminal

- **Workspace** — Tabs e Panes misturados, Workspaces nomeados, reconexão do tmux, Connection Notes, Git Browser e File Compare.
- **Assistente de IA** — ferramentas com aprovação para Sessions, Dashboard, IT Ops e Custom Modules, além de anexos, envio ao terminal, MCP e Assistant Skills reutilizáveis.
- **Dashboard** — Views alternáveis com Widgets integrados ou criados por IA, arrastáveis e redimensionáveis. Inclui App Launcher, painéis de Connection ao vivo, Notes, medidores de uso e ferramentas utilitárias.
- **IT Ops** — topologia Site → Server Room → Rack (elevation, floor plan e vista 2.5D), inventário de Hosts e varreduras de conectividade, Tasks Script/Playbook reutilizáveis, Batch Runs via SSH/WinRM/PsExec, IPAM, VLAN, Network Maps, histórico e exportações em PDF/CSV.
- **Screenshots** — capture uma região, janela ou a área de trabalho inteira; salve em uma biblioteca local ou na área de transferência; redimensione/converta em lote; e anote com recorte, formas, texto e mosaico.
- **Custom Modules** — instale pacotes `.kkmod` isolados em Settings, revise as permissões declaradas, adicione destinos à Activity Rail e gerencie atualizações, rollback, armazenamento e desinstalação. O repositório inclui integrações como Excalidraw, BentoPDF, OpenFlowKit e TiddlyWiki.
- **Install Helper (Windows)** — pesquise, instale, atualize e desinstale ferramentas, aplicativos web locais e serviços compatíveis sem sair do KKTerm.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="Elevações de racks do IT Ops com indicadores de estado dos dispositivos" width="720" />
</p>

## Do seu jeito

As Views do Dashboard, as Connections do terminal, o visualizador de documentos e as vistas de detalhe do IT Ops compartilham o mesmo seletor de fundos. Escolha cores e gradientes, imagens e vídeos locais ou **84 fundos dinâmicos integrados**, com oceanos, clima, cenas WebGL, espaço, gráficos de rede e movimento abstrato. Cenas ocultas ou fora da tela são pausadas e liberam seus recursos de renderização. Temas de cores, aparência do terminal, fontes personalizadas e fundos por Connection completam a personalização.

<p align="center">
  <img src="docs/assets/screenshots/backgrounds.png" alt="Seletor de fundos dinâmicos do KKTerm" width="720" />
</p>

## Veja em ação

<p align="center">
  <img src="docs/assets/demo.gif" alt="Demonstração do KKTerm" width="720" />
</p>

## Obtenha o KKTerm

Baixe a [versão mais recente](https://github.com/ryantsai/KKTerm/releases/latest) para Windows, macOS ou Linux. O Windows oferece um instalador e ZIPs portáteis x64/ARM64; extraia o ZIP em uma pasta local gravável ou em uma unidade removível, não em um compartilhamento de rede. Verifique o arquivo `.sha256` ao lado antes de executar o pacote.

Para compilar a partir do código-fonte, comece por [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Contribua, apoie e consulte a documentação

Contribuições e relatos de bugs são bem-vindos. Consulte [`CONTRIBUTING.md`](CONTRIBUTING.md), o [manual de operação](docs/manual/INDEX.md), a [arquitetura](docs/ARCHITECTURE.md), o [guia do Dashboard](docs/DASHBOARD.md), o [guia de IT Ops](docs/ITOPS.md) e a [API do host de Custom Modules](docs/KKMOD_HOST_API_V2.md).

Se o KKTerm for útil para você, pode [me pagar um café](https://buymeacoffee.com/ryantsai).

## Licença

O código-fonte do KKTerm usa MIT com Commons Clause. Crates vendorizados, Custom Modules, fontes e pacotes de ícones continuam sob suas próprias licenças; consulte [`LICENSE`](LICENSE) e os avisos em seus diretórios.
