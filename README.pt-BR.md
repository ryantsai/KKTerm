<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>Uma única janela nativa do Windows para terminais, SSH, SFTP, RDP/VNC e um painel — mais uma IA que constrói as suas próprias ferramentinhas sob demanda.</strong>
</p>

<p align="center">
  <em>Porque a sua barra de tarefas não devia parecer um caça-níquel de Las Vegas.</em>
</p>

<p align="center">
  <sub>Batizado em homenagem ao <strong>乖乖 (Kuāi Kuāi)</strong>, o salgadinho verde de coco que os sysadmins taiwaneses colocam sobre os servidores para que se comportem. Esperamos que este app conquiste seu lugar no rack.</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">Baixar a versão mais recente do KKTerm</a></strong>
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
    <strong>Português (BR)</strong> ·
    <a href="README.th.md">ไทย</a> ·
    <a href="README.id.md">Bahasa Indonesia</a> ·
    <a href="README.vi.md">Tiếng Việt</a>
  </sub>
</p>

---

## O pitch em 45 segundos

O KKTerm reúne terminais locais, SSH/SFTP, FTP/FTPS, Telnet, conexões seriais, RDP/VNC, páginas web integradas, arquivos locais e documentos em um único workspace. Uma Tab pode misturar diferentes tipos de Pane, mantendo juntos o terminal, o navegador de arquivos e a tela remota de cada tarefa.

Ele roda no Windows, macOS e Linux, armazena os dados localmente e não usa telemetria. IA sujeita a aprovação, widgets de Dashboard personalizáveis, Workspaces, IT Ops e o Install Helper para Windows estão integrados.

---

## Por que «KKTerm»?

Entre em qualquer data center taiwanês e olhe o topo dos racks. Passando pelas fábricas da TSMC, salas de controle do metrô de Taipei, salas de servidores do banco Cathay, equipamentos de comutação da Chunghwa Telecom — você vai avistar um saquinho verde de 乖乖 (Kuāi Kuāi), um salgadinho de milho com sabor de coco dos anos 1960.

**KKTerm** é **Kuai Kuai Term** — um espaço de administração que aspira ao mesmo trabalho do salgadinho: sentar quietinho ao lado das suas máquinas importantes e ajudá-las a se comportar. Local primeiro. Sem telemetria. IA com aprovação. Aquele tipo de software entediante e confiável.

Ainda não conseguimos enviar um saquinho de Kuai Kuai de verdade junto com o instalador. Isso é item pra v2.

---

## Ver em movimento

<p align="center">
  <a href="https://github.com/ryantsai/KKTerm">
    <img
      src="docs/assets/demo.gif"
      alt="KKTerm demo"
      width="720"
    />
  </a>
</p>

<p align="center"><sub><em>(O GIF de demonstração. Uma imagem vale mais que mil bullet points, e nossos bullet points acabaram.)</em></sub></p>

---

## Uma janela, cada conexão

| Você queria… | O KKTerm faz |
| --- | --- |
| Abrir um shell local PowerShell / cmd / WSL | Terminais locais, lado a lado |
| SSH num servidor | SSH com chaves, agent, senhas, jump hosts e encaminhamento de portas |
| Navegar pelos arquivos desse servidor | SFTP a partir da conexão SSH — painel duplo, arraste para transferir |
| FTP num NAS de 2012 | FTP / FTPS no mesmo navegador de arquivos |
| Telnet num equipamento pré-histórico | Sim, Telnet também está aí |
| Falar com uma porta serial | Conexões seriais — escolha porta COM e baud |
| Acessar remotamente uma máquina Windows | A verdadeira Área de Trabalho Remota da Microsoft, embutida |
| VNC num Pi | VNC, renderizado direto no espaço de trabalho |
| Abrir a interface web do roteador | Uma aba de navegador embutida com logins salvos |
| Navegar pelo seu próprio disco | Um painel File Explorer local, o mesmo painel duplo do SFTP |
| Abrir um log, CSV, imagem ou PDF | Um visualizador Document embutido com um verdadeiro modo de log em acompanhamento (tail) |
| Acompanhar a CPU do host | Uma barra de status ao vivo e um painel que você mesmo monta |

O mesmo app. A mesma janela. Os mesmos atalhos. O mesmo tema, que tomara não faça seus olhos sangrarem.

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="Uma única Tab com SSH, SFTP e uma UI web embutida lado a lado" width="720" />
</p>

---

## Por que as pessoas deixam aberto o dia inteiro

### Download pequeno, abertura relâmpago

O KKTerm foi feito para parecer uma utilidade, não uma plataforma. As builds desktop atuais ficam abaixo de 20 MB, instalam rápido e abrem tão depressa que abrir seu workspace de administração não parece iniciar um segundo sistema operacional.

### Grades multipainel, misturadas do seu jeito

Uma Tab pode ter uma grade de Panes, e esses Panes não precisam ser do mesmo tipo. Coloque SSH ao lado de SFTP, uma PowerShell local abaixo de uma RDP Session, VNC ao lado da interface web do roteador, ou um navegador de arquivos perto do terminal que está movendo os arquivos.

<p align="center">
  <img src="docs/assets/screenshots/multi-pane.png" alt="Uma Tab dividida em quatro painéis de tipos de conexão diferentes" width="720" />
</p>

### Um assistente de IA que comanda seus terminais por você

A maioria das demos de «IA no seu terminal» para no chat. O assistente do KKTerm trabalha *dentro* da sua sessão: você passa pra ele o contexto do que já está na tela, e ele age sobre as máquinas a que você está conectado — com um humano no laço de aprovação.

<p align="center">
  <img src="docs/assets/screenshots/ai-assistant.png" alt="O painel do assistente de IA com os interruptores de acesso a ferramentas e modo de aprovação" width="720" />
</p>

### Um painel que não finge ser o Grafana

O Dashboard é uma grade de widgets que você arrasta e redimensiona. Não é pra observabilidade em escala de petabytes — é pra «quero um botão que abra meus cinco apps favoritos e um painel mostrando o uptime do meu host SSH, *do lado* do meu chat».

As Views do Dashboard oferecem 45 fundos animados integrados ao KKTerm. Os oito mais recentes são cenas WebGL procedurais: `heroGeometric`, `ditherPrismHero`, `webglLiquid`, `silkAurora`, `closingPlasma`, `animatedGradient`, `prismGradient` e `liquidChrome`. O mesmo seletor de fundos está disponível para Connections de terminal, o Document viewer e as visualizações detalhadas do IT Ops; cenas ocultas ou fora da tela param de renderizar e liberam seus recursos WebGL.

<p align="center">
  <img src="docs/assets/screenshots/ai-widgets.png" alt="Uma grade de painel cheia de widgets criados pela IA" width="720" />
</p>

### IT Ops para sites, hosts e trabalho repetível

O Module **IT Ops** agrupa Connections em Sites, mapeia salas de servidores e racks, inventaria Hosts e executa Tasks reutilizáveis nas máquinas selecionadas. Batch Runs preservam resultados por Host, enquanto Automations transformam gatilhos e condições em notificações, webhooks ou Tasks.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="A vista frontal da sala de servidores do IT Ops com seis racks equipados e indicadores de status dos Hosts" width="720" />
</p>

### Capture, organize e anote capturas de tela

O Module **Screenshots** captura uma região, uma janela ou toda a área de trabalho para uma biblioteca local, para a área de transferência ou para ambas. Organize e agrupe as capturas, redimensione ou converta várias de uma vez e abra qualquer imagem no editor integrado para recortar, desenhar à mão livre, adicionar setas, formas e texto ou ocultar detalhes com mosaico. Atalhos globais e o menu da bandeja deixam a captura sempre a uma tecla de distância.

<p align="center">
  <img src="docs/assets/screenshots/screenshots-module.png" alt="O Module Screenshots com controles de captura e uma biblioteca de miniaturas" width="720" />
</p>

### Mantenha vivos os seus agentes de IA

Essa é a segunda função pela qual as pessoas se apaixonam. Os terminais SSH do KKTerm podem te jogar direto numa **sessão tmux nomeada** no host remoto que sobrevive à reconexão.

<p align="center">
  <img src="docs/assets/screenshots/tmux-reattach.png" alt="Um painel SSH se reconectando a uma sessão tmux nomeada após uma reconexão" width="720" />
</p>

### Mantenha seus mundos separados com Workspaces

O homelab, o trabalho e os servidores daquele cliente não pertencem à mesma lista. **Workspaces** são contêineres de Connections nomeados e isolados entre os quais você alterna pela Activity Rail. Alternar reescopa só a árvore de conexões — suas Sessions abertas, o Dashboard e as configurações ficam onde estão — então mudar de contexto custa um clique, não um reinício.

<p align="center">
  <img src="docs/assets/screenshots/workspaces.png" alt="O seletor de workspace na activity rail" width="720" />
</p>

### Vista do seu jeito: temas de cores

Os fundos são a parte divertida; os **temas de cores** são o que você de fato encara o dia todo. O KKTerm traz **vinte e seis** esquemas de cores que reestilizam todo o chrome do app — Activity Rail, árvore de conexões, abas, diálogos — com uma miniprévia ao vivo de cada um em Configurações ▸ Aparência.

<p align="center">
  <img src="docs/assets/screenshots/color-themes.png" alt="A grade de esquemas de cores nas Configurações com prévias ao vivo" width="720" />
</p>

### Install Helper (somente Windows)

Preparar uma máquina Windows nova pra desenvolvimento normalmente é dez abas do navegador e muito «avançar, avançar, concluir». O **Install Helper** é um catálogo embutido que acha, instala, atualiza e desinstala as ferramentas que você senão caçaria na mão — sem sair do KKTerm.

<p align="center">
  <img src="docs/assets/screenshots/install-helper.png" alt="O catálogo Install Helper com ferramentas instaladas e disponíveis" width="720" />
</p>

---

## O que o KKTerm não é

Uma lista curta, porque honestidade conquista confiança:

- **Não é um produto de nuvem.** Sem sincronização, sem contas de equipe, sem plano SaaS. Se você um dia vir um diálogo «Entrar no KKTerm», algo deu catastroficamente errado.
- **Não finge que todos os sistemas operacionais são idênticos.** O KKTerm publica builds para Windows, macOS e Linux, mas mantém claras as funções específicas de cada plataforma.
- **Não é um agente de IA autônomo.** O assistente propõe; o humano decide. `Allow All` é uma escolha que você faz, não um padrão.
- **Não é um substituto pro Grafana / Datadog.** O Dashboard é pra superfícies de controle pessoais, não pra observabilidade de 10 mil hosts.
- **Não é uma IDE de Kubernetes.** É um espaço de administração centrado no terminal. Por favor, não peça pra ele renderizar um chart do Helm.

Se algum desses pontos *era* um motivo de desistência — justo, a gente se vê na v2.

---

## Pegue o KKTerm

**[Baixe a versão mais recente do KKTerm](https://github.com/ryantsai/KKTerm/releases/latest)**, escolha o pacote para a sua plataforma e abra. Os instaladores do Windows no momento estão **sem assinatura** — a assinatura de release está no roadmap, então até lá o seu antivírus pode te olhar torto. É normal.

Quer compilar do código-fonte ou contribuir? Tudo que você precisa está em [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Roadmap (versão curta)

- Polimento de releases multiplataforma
- Polimento da assinatura de releases
- Mais poder na transferência de arquivos (retomar, sync de pastas, arquivar/extrair)
- Compartilhamento de área de transferência e dispositivos mais rico na Área de Trabalho Remota
- Mais widgets de painel embutidos
- Mais funcionalidade de automação de IT Ops

Versão completa e atualizada com frequência: [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Contribuir

A gente adoraria uma mão. De verdade. Até coisas pequenas importam.

Setup completo, estrutura do projeto e checklist de PR estão em [`CONTRIBUTING.md`](CONTRIBUTING.md). Procurando um ponto de entrada? Filtre as issues abertas por [`good first issue`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) ou [`help wanted`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22).

---

## Documentos do projeto

- [Contexto de produto](CONTEXT.md) — a linguagem de domínio que você deve respeitar
- [Arquitetura](docs/ARCHITECTURE.md) — mapa de módulos, onde colocar código novo
- [Manual do usuário](docs/manual/INDEX.md) — um passeio recurso por recurso
- [Roadmap](docs/ROADMAP.md)
- [Arquitetura do Dashboard](docs/DASHBOARD.md)
- [Servidor MCP embutido](docs/MCP.md)
- [Guia de provedores de IA](docs/AI_PROVIDERS.md)

---

## Licença

MIT. Veja [LICENSE](LICENSE). Use, faça fork, publique, coloque num homelab que ninguém mais vai achar — esse é o trato.
