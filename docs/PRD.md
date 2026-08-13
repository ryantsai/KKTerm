# KKTerm PRD

## Problem Statement

Administrators, developers, and operators often juggle separate tools for local terminals, SSH sessions, SFTP transfers, saved host lists, and AI-assisted command work. Existing tools either feel dated and Windows-only, focus narrowly on terminal emulation, or carry heavyweight runtime and UI costs that make them feel slow.

KKTerm is intended to be a fast, professional desktop workspace for personal/local infrastructure administration. The first version provides the core experience users expect from a modern MobaXterm/RDCMan/VSCode-inspired tool, including terminal, file-transfer, URL, RDP, and VNC workflows, while keeping team sync and managed cloud services out of scope.

## Solution

KKTerm v0.1 will be a cross-platform desktop app built with a Rust/Tauri core and a React/TypeScript interface. It organizes functionality into built-in Modules accessible from a left-side Activity Rail: **Workspace** (a named-Workspace connection manager where each Workspace isolates its own Connections and folders while live Sessions/Tabs stay open across Workspace switches; includes VSCode-style tabs, split terminal panes, local terminal sessions, SSH sessions with optional tmux resume, SFTP/FTP dual-pane file management, File Explorer, RDP, VNC, and URL connections), **Dashboard** (dynamic widget playground with prebuilt tools, reports, and an App Launcher widget for quick-launch apps/files), and **Install Helper** (a curated Windows developer-tool catalog for detecting, installing, updating, uninstalling, and launching supported tools).

Under the hood it provides explicit screenshot capture to clipboard or AI context for workspace surfaces, backend SSH config import support, local SQLite connection storage, platform secret storage, and approval-bounded AI assistance that can use typed app tools for Dashboard work, saved Connection management, and active Session interaction.

The product will be light chrome with dark terminal panes by default, optimized for dense professional workflows and fast launch across Windows, macOS, and Linux. Mobile, team vaults, and sync remain later-stage scope.

## User Stories

1. As a Windows administrator, I want KKTerm to launch quickly, so that I can start work without waiting on a heavy desktop app.
2. As an operator, I want a left-side connection tree, so that I can open Connections from the root or organize them into folders when useful.
3. As an operator, I want to create saved SSH connections, so that I do not retype hostnames, usernames, ports, or key paths.
4. As an operator, I want optional folders and subfolders in the connection tree, so that I can group hosts by project, environment, customer, or region without forcing every Connection into a folder.
4a. As an operator, I want multiple named Workspaces with separate Connection trees, so that I can isolate customer, lab, or project resources without mixing their saved Connections.
4b. As an operator creating a Workspace, I want to copy selected Connections from an existing Workspace, so that I can start from known resources without sharing mutable Connection records between Workspaces.
5. As an operator, I want search and filtering in the connection tree, so that large host lists remain usable.
6. As an operator, I want drag/drop reorder in the tree, so that I can keep my workspace arranged naturally.
7. As an operator, I want rename, delete, and duplicate actions for folders and connections, so that connection maintenance is fast.
8. As an operator, I want quick connect, so that I can connect to a host without saving a full connection first.
9. As an SSH user, I want to import entries from my SSH config, so that KKTerm can bootstrap my existing workflow.
10. As an SSH user, I want imported SSH config entries to preserve host, user, port, identity file, and proxy jump when possible, so that imported connections behave as expected.
11. As an SSH user, I want unsupported SSH config directives to be visible, so that I understand what may need manual adjustment.
11a. As an operator coming from another tool, I want to import Connections in bulk from CSV/TSV, RDCMan `.rdg`, MobaXterm `.mxtsessions`, or PuTTY `.reg` exports, so that I can populate KKTerm without retyping every host. Imported nested folders should round-trip as ConnectionFolders.
11b. As an operator on a new network, I want a light TCP port scan over a single host, hyphen range, or CIDR (capped per scan) with SSH/Telnet/RDP probes, so that I can seed Connection drafts from what is actually reachable.
11c. As an operator, I want an editable preview before imported Connections are persisted, with bulk username and optional bulk password actions across the current selection, so that I can fix placeholder values once instead of per row.
12. As a terminal user, I want local terminal tabs, so that KKTerm can replace my daily terminal for common work.
13. As a terminal user, I want local terminal connections to require no host details, so that launching the default shell is fast and obvious.
14. As a Windows user, I want saved local terminal options for PowerShell, Command Prompt, and WSL, so that local terminals match the shell I need.
15. As a terminal user, I want SSH terminal tabs with optional named tmux session resume per Pane, so that remote shell work happens in the same workspace as local work and can return to the same remote context.
15a. As a terminal power user, I want Child Connection Tabs in the Connection Tree, so that repeated Tabs for the same saved Connection can be named, reopened lazily, resumed into the same tmux session or directory, and viewed together as a multi-Pane layout without crowding the top Tab Strip.
16. As a terminal user, I want split terminal panes, so that I can monitor and operate multiple shells in one tab.
17. As a terminal user, I want xterm-compatible behavior, so that tools like vim, tmux, htop, btop, lazygit, git, npm, pnpm, and cargo work correctly.
18. As a terminal user, I want truecolor, mouse support, alternate screen, bracketed paste, hyperlinks, and scrollback search, so that modern terminal apps feel correct.
19. As a terminal user, I want configurable font family, font size, line height, cursor style, and scrollback size, so that the terminal fits my workflow.
20. As a terminal user, I want copy-on-select as a toggle, so that I can choose the selection behavior I prefer.
21. As a terminal user, I want multiline paste confirmation, so that accidental command floods are prevented.
22. As a Windows user, I want a configurable default shell, so that local terminals can use PowerShell, Command Prompt, WSL, or another shell later.
23. As an SSH user, I want password authentication, so that I can connect to hosts that do not use key auth.
24. As an SSH user, I want key-file authentication by path, so that KKTerm uses my existing SSH keys.
25. As an SSH user, I want SSH agent support where practical, so that I can use existing key workflows.
26. As an SSH user, I want known-host verification, so that first connections and host-key changes are explicit.
27. As an SSH user, I want resize events to propagate to remote terminals, so that full-screen terminal apps render correctly.
28. As an SSH user, I want to open SFTP from an SSH terminal, so that file transfer uses the same saved Connection instead of a separate SFTP entry.
29. As an SFTP user, I want a dual-pane file manager, so that local and remote files can be transferred without switching tools.
30. As an SFTP user, I want upload and download for files and folders, so that common transfer work is covered.
31. As an SFTP user, I want create folder, rename, delete, and refresh, so that I can manage remote files.
32. As an SFTP user, I want multi-select drag/drop transfer between local and remote panes, so that batch upload and download feels natural.
33. As an SFTP user, I want a focused right-click menu with transfer, rename, delete, and properties, so that file actions stay predictable in the SFTP workspace.
34. As an SFTP user, I want remote properties with chmod and chown controls, so that permission and ownership fixes can be made without leaving the app.
35. As an SFTP user, I want a transfer queue with progress, cancellation, and clearable finished history, so that long operations are visible without old records piling up.
36. As an SFTP user, I want an "open terminal here" action, so that I can jump from remote file navigation to shell work.
37. As an SFTP user, I want overwrite prompts with an overwrite-all option, so that file transfer conflicts stay explicit without slowing down large batches.
38. As a user, I want to capture an entire active workspace surface or a selected Region to the clipboard, so that I can share visible terminal, SFTP, URL, RDP, or VNC context without saving files.
39. As a user, I want light app chrome with dark terminal panes, so that the interface feels clear while terminals remain comfortable.
40. As a user, I want a Settings entry point that clearly shows Language (i18n) and Color Scheme as planned areas, so that future customization work has an obvious home without implying unfinished controls work today.
41. As a user, I want local SQLite storage for non-secret settings and connections, so that the app remains local-first and reliable.
42. As a user, I want secrets stored in the configured secret backend, so that passwords, passphrases, and API keys are not stored in plaintext config.
43. As a user, I want no telemetry by default, so that my terminal and host data remain private.
44. As a user, I want local logs and a diagnostics bundle command, so that I can debug issues without automatic data upload.
45. As a user, I want AI command assistance to draft commands, so that I can move faster without surrendering control.
46. As a user, I want AI tool execution to default to Prompt mode, so that mutating operations do not run silently unless I explicitly choose Allow All.
47. As a user, I want AI help scoped to the active local or SSH Session, so that context stays clear.
48. As a user, I want OpenAI-compatible API configuration, so that I can use my own endpoint, key, and model.
49. As a user, I want Claude Code CLI and Codex CLI paths configurable, so that local agent tools can be used from KKTerm.
49a. As a Windows user, I want an Install Helper Module with a curated developer-tool catalog, so that I can detect, install, update, uninstall, and launch common tools without hunting for separate setup instructions.
50. As a user, I want Claude Code CLI and Codex CLI integrations restricted to suggest/ask-before-execute where possible, so that they respect the product trust model.
51. As a contributor, I want an MIT open-source project, so that licensing is clear and permissive.
52. As a maintainer, I want dependencies compatible with MIT/Apache-2.0/BSD/MPL-style use, so that runtime licensing stays clean.
53. As a maintainer, I want GPL dependencies avoided in the core runtime, so that copyleft obligations are not introduced unintentionally.
54. As a maintainer, I want performance budgets documented, so that architectural decisions can be judged against measurable targets.
55. As a Windows user of the installed app, I want update checks to be available after release signing is configured, so that I can learn about stable signed releases without manually monitoring GitHub.
56. As a Windows user of the installed app, I want update installation to require my confirmation, so that KKTerm does not silently replace itself while I am using administrative tools.
57. As a privacy-conscious user, I want update checks to be clearly described as contacting GitHub Releases/update metadata only when the update mechanism is enabled, so that the local-first trust model remains understandable.
58. As a power user, I want the AI Assistant to draft KKTerm extensions with manifests, permissions, and source files, so that I can explore workflow automation without generated code being installed or run automatically.
58a. As a user, I want to install optional static web apps as Custom Modules after KKTerm is installed, so they can become permanent Activity Rail tools without bloating the main installer or requiring a local HTTP service.
59. As an operator, I want the AI Assistant to list, add, edit, open, and delete saved Connections through typed tools, so that routine Connection maintenance can be done conversationally while preserving saved-data boundaries.
60. As an operator, I want the AI Assistant to inspect and interact with active Sessions through typed tools, so that it can read terminal buffers, send terminal text, inspect RDP/VNC screenshots, send remote desktop text/keys/mouse clicks, and perform SFTP/FTP file-browser actions when permitted.

## Implementation Decisions

High-level product decisions that are not duplicated elsewhere:

- Product name: **KKTerm**. Supported desktop release targets: Windows, macOS, and Linux on the same architecture.
- Current protocols: local terminal, SSH terminal, Telnet terminal, Serial terminal, SFTP launched from SSH, FTP/FTPS, URL (WebView2), RDP (ActiveX), and VNC (`vnc-rs`).
- License: MIT. Dependencies should be MIT/Apache-2.0/BSD/MPL-style; avoid GPL in the core runtime.
- Privacy: no telemetry or automatic crash upload in v0.1. Update checks and user-mediated installer handoff are described separately from telemetry.
- AI model: typed assistant tool calling with permission boundaries. Prompt is the default mode for mutating tools; Allow All is an explicit user setting for automatic execution of enabled tools. CLI agent integrations remain suggest-only/ask-before-execute where possible.

The full stack, frontend source map, storage/secrets boundaries, command-runtime rules, RDP overlay model, Settings layout, and Activity Rail layout live in `docs/ARCHITECTURE.md`. Standalone decision records (SSH transport, security/privacy, extension platform, etc.) live in `docs/ADR/`. Performance budgets and the measurement runbook live in `docs/PERFORMANCE.md`. Distribution, packaging scripts, update checks, and the installer download/install flow live in `docs/RELEASE.md`.

## Testing Decisions

- Test external behavior rather than implementation details.
- Rust unit tests cover config, storage, SSH config import, and AI command planning safety.
- SQLite schema initialization gets integration tests.
- Frontend component tests cover connection tree, search/filter, tabs, and split pane behavior where useful.
- Playwright smoke tests cover core UI flows.
- Manual terminal compatibility checklist (`docs/PERFORMANCE.md`) covers vim, tmux, htop/btop, git, npm, and cargo.
- Windows installer gets a smoke test before v0.1 release.
- Performance checks verify the budgets documented in `docs/PERFORMANCE.md`.

## Out of Scope

- Mobile apps for iOS or Android.
- Additional remote desktop protocols beyond RDP and VNC.
- Team sharing, team vaults, RBAC, SSO, managed cloud services, or paid AI service.
- Settings sync.
- Global command palette or command launcher.
- Silent install, rollback/downgrade, preview-channel, managed-server, or cross-platform auto-update behavior.
- Dynamic inventory from cloud APIs, Terraform, CMDB, or other external sources beyond the supported file imports (CSV/TSV, RDCMan `.rdg`, MobaXterm `.mxtsessions`, PuTTY `.reg`) and the bundled light TCP port scan.
- Folder sync, diff/compare, transfer resume, archive/extract, and remote file editing in SFTP.
- Unattended fully autonomous AI agent operation.
- Editable keybinding UI.

## Further Notes

KKTerm is open-source under MIT. The codebase should prefer deep, single-purpose source areas with small, testable interfaces for storage, connections, terminal sessions, SSH/SFTP transport, renderer abstraction, AI provider adapters, command approval, and importers.

The product should feel like a quiet, dense, professional desktop tool. Avoid marketing-style layouts, decorative gradients, oversized cards, or generic admin-dashboard styling.
