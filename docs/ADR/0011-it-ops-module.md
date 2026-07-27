# ADR 0011: IT Ops Module

## Status

Accepted, with the durable Monitor portion retired by schema version 55.

The Site, Host, Task, Batch Run, and topology decisions remain active. The
former Monitor UI/runtime/tooling is removed; legacy `itops_automations` rows
are disabled, stamped obsolete, and retained only for backup/export recovery.
See `docs/ITOPS.md` for the current Module contract.

## Context

KKTerm manages many saved Connections, but every action today is
single-host and interactive: open one Session, type in one terminal,
browse one SFTP tree. Operators repeatedly need the opposite — run the
same task across a site (push an update script to every SSH host, drive
a Windows Update pass across a set of servers) and get one consolidated
result — and they need unattended *monitoring* that watches a signal and
reacts without a human staring at a terminal.

The second need already half-exists. The **Watchdog** (`src-tauri/src/watchdog/`,
`src/watchdog/`) is a clean sensor → predicate → action loop with a pure
`evaluate_predicate`, a state machine, a single event channel, and a
`Notify` / `AiIntervene` action split. But it is **in-memory and
session-scoped by design** (`CONTEXT.md`, `watchdog/mod.rs`): a watchdog
cannot be saved, does not survive restart, and is surfaced only as a
Status Bar indicator. That makes it a developer-grade live probe, not the
"create a monitor once and let it run" experience operators want.

The roadmap already reserves an **IT Ops Center** section
(`docs/ROADMAP.md`) listing batch broadcast, a simple approval-gated
workflow engine, update playbooks (apt/dnf/yum, Windows Update via WinRM),
AI-enabled triggers, and a reusable workflow library with durable run
history. This ADR promotes that planned scope into a concrete Module and
decides how the Watchdog migrates into it.

Two product guardrails constrain the design:

1. `docs/PRD.md` lists **"Unattended fully autonomous AI agent
   operation"** as out of scope, while the roadmap allows a workflow
   engine **with explicit per-run approval**. The automation engine must
   stay rule-driven over a finite, typed action catalog — not an open
   agent.
2. The High-Risk Invariants forbid putting **live Session/runtime state
   into durable models**. Durable automation *definitions* may persist;
   their live poll/run state must not.

## Decision

Add **IT Ops** as a new top-level Activity Rail Module (a new `ActivePage`
value `itops`, source under `src/modules/itops/`, a new `itops` i18n
namespace), grouped with Dashboard and Install Helper above Settings. It
is not a Connection, not a Session, and not a Dashboard widget.

The Module owns three surfaces:

1. **Host Groups** — durable named selections of existing Connections
   (plus ad-hoc filters by type/folder). A Host Group is the site target
   for both batch runs and automations. It references Connection ids; it
   is **not** a new Connection type and stores no secrets.

2. **Batch Runs** — pick a Host Group + a task, fan out with bounded
   concurrency, stream per-host output, and store a consolidated run
   report. Tasks are a free-form script/command or a curated **update
   playbook** (apt/dnf/yum, Windows Update) with **dry-run preview** and
   **explicit per-run approval**.

3. **Automations** — the evolved Watchdog: durable **trigger → optional
   condition → ordered actions** rules.

### Persistence and "always-on" model

Automations and Host Groups are **durable definitions in SQLite** that
**re-arm on app launch**, but they poll and fire **only while KKTerm is
running**. KKTerm installs **no background OS service or daemon**; the
local-first, no-daemon posture is preserved. The live poll loop,
in-flight run state, tick ring buffers, and run progress remain
**in-memory**, exactly as the Watchdog runtime is today and as the
High-Risk Invariant requires. A new SQLite schema version adds
`itops_host_groups`, `itops_automations`, and `itops_run_history`; the
existing Watchdog registry becomes the runtime that hydrates from
`itops_automations` at startup.

### Automation engine model

The engine is a **linear trigger → condition → actions** rule, a direct
generalization of the current `WatchdogConfig`. One trigger, an optional
condition (today's `PredicateOp`), and an ordered list of actions from a
**finite typed catalog**. We deliberately do **not** build an n8n-style
multi-node DAG with inter-node data passing in v1: it is a major engine +
visual-editor effort and edges toward the autonomous-agent line the PRD
puts out of scope. The linear model covers the stated use cases
(email / popup / webhook / batch / AI) and keeps the pure predicate
evaluator and run loop intact.

- **Triggers** generalize `WatchdogTarget`: existing perf-counter,
  ping/TCP, SSH output silence; new scheduled probe (cron), output
  regex match, SFTP path change, inbound webhook, and a structured/
  unstructured datasource poller (HTTP-JSON / command-output / log-file).
- **Conditions** are the existing `PredicateOp` set, unchanged.
- **Actions** generalize `WatchdogAction` into a catalog: notify
  (toast/sound/in-app), desktop popup, send email (SMTP), call webhook,
  run a Batch Run on a Host Group, and the existing AI intervention.

### Windows batch transport

Batch Runs support **three** Windows transports, selected per Host Group
or per run:

- **SSH (Windows OpenSSH)** — reuses the existing `russh` exec path with
  zero new transport code; preferred when the host runs OpenSSH server.
- **WinRM / WS-Man** — HTTP-based remote exec, the standard path for
  Windows Update playbooks. No shipped binary; built as a thin client on
  license-clean crates per `docs/ADR/0012-winrm-transport-library.md`
  (the turnkey WinRM crates are GPL and disqualified).
- **PsExec** — Sysinternals binary delivered through an Install Helper
  recipe (kind `downloadInstaller`/`githubRelease`), for environments
  that already rely on it.

SSH fan-out reuses the bounded-concurrency pattern already proven in the
Connection Batch Importer's network scan (`src-tauri/src/import.rs`).

### Boundaries and reuse

- **Secrets** (SMTP credentials, webhook tokens, WinRM/PsExec
  credentials) live in the OS keychain under the existing secret-owner
  model; SQLite stores only non-secret metadata and references.
- **Command-runtime invariant:** all fan-out exec, WinRM/SMTP/webhook
  I/O, and probes run through `spawn_blocking`/worker tasks with progress
  events; they must never block the UI thread (`docs/ARCHITECTURE.md`).
- **AI integration** reuses the approval-gated assistant tool model. The
  assistant may *draft* Host Groups and Automations (as it drafts
  Dashboard widgets) and emits an `itops-changed` event to reload the
  store, but actions remain in the typed catalog — no autonomous agent.
- Durable architecture detail lives in `docs/ITOPS.md`; when it conflicts
  with `docs/ARCHITECTURE.md` on IT-Ops-internal concerns, `ITOPS.md`
  wins.

## Consequences

- The Watchdog stops being a hidden session-scoped probe and becomes a
  first-class, saveable Automation surfaced in a Module, while its proven
  Rust run-loop and pure predicate evaluator are preserved. The Status Bar
  indicator and detail panel remain as the live view of running
  Automations.
- KKTerm gains true site operations without taking on a background
  service, a cloud control plane, or autonomous AI — staying inside the
  local-first, approval-gated scope the PRD defines.
- New durable state (Host Groups, Automations, run history) means a new
  SQLite schema version and inclusion in the selective export/import
  shape (ADR 0010). Run history is local-first with no telemetry.
- Choosing the linear engine over a DAG defers branching/fan-out
  workflows; if a real need appears, a future ADR can revisit a node
  graph without invalidating the durable rule shape.
