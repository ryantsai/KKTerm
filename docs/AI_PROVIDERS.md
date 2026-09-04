# AI Provider and Assistant Skill Integration Guide

This guide describes the expected structure for extending the KKTerm AI
Assistant. The first part covers adding AI **providers**: the Rust agent runner,
the TypeScript Settings/provider registry, and localization follow-up. The last
section covers bundled **Assistant Skills**. Built-in MCP tools are documented
separately in `docs/MCP.md`.

## Design boundary

KKTerm currently supports AI chat through the OpenAI-compatible request/response
runtime in `src-tauri/src/ai.rs`. A new provider is a small metadata adapter when
it can use that runtime: Chat Completions or Responses-style HTTP endpoints,
Bearer or API-key-header authentication, the shared tool-calling payload shape,
and the existing model/reasoning settings.

If a provider needs a different protocol, OAuth flow, SDK bridge, request schema,
or streaming format, do **not** force it into the OpenAI-compatible adapter. Add a
proper `AgentProvider` implementation in Rust and document the new runtime shape.
That is intentionally more than a one-file provider addition.

Z.ai and Moonshot AI use this metadata-adapter path. Their hosted endpoints are
OpenAI-compatible Chat Completions APIs with Bearer authentication and
OpenAI-compatible model lists, so they reuse the shared streaming, tool-calling,
approval, keychain, and model-refresh behavior.

Some OpenAI-compatible providers emit small Chat Completions streaming variants.
For example, Gemini's OpenAI-compatible SSE tool-call deltas may omit
`tool_calls[].index` even though OpenAI includes it; other compatible services
may vary harmlessly in SSE `data:` spacing, whether argument fragments arrive as
strings or JSON values, or when a tool-call id appears. Keep these compatibility
normalizations in `src-tauri/src/ai/streaming.rs` and lock them with recorded
SSE fixtures under `src-tauri/src/ai/fixtures/` instead of scattering
provider-specific request or parser code through provider metadata files.
When a provider returns opaque tool-call metadata that must be replayed in the
next request, preserve it on the shared `OpenAiToolCall` rather than losing it
during transcript normalization. Gemini 3 thinking models are the concrete case:
their OpenAI-compatible `tool_calls[].extra_content.google.thought_signature`
must be sent back on the assistant tool-call message before the tool result, or
Gemini rejects the next request with a 400 missing-thought-signature error.

GitHub Copilot uses `github-copilot-sdk` only as a runtime bridge to an installed
or path-resolved Copilot CLI. KKTerm must never bundle the Copilot CLI into the
app binary or installer. Keep the Cargo dependency on `github-copilot-sdk`
explicitly declared with `default-features = false`; do not enable the SDK's
`bundled-cli` feature, set build-time CLI embedding variables, or add a release
path that embeds Copilot CLI assets. The installer must stay lean, and Copilot
CLI availability should be resolved at runtime from user/system installation
state.

OpenAI and Anthropic can also be routed through their local coding CLIs when the
user enables the Settings toggles `settings.useCodexCli` or
`settings.useClaudeCli`. Cursor is a CLI-only provider: select the Cursor
provider and enable `settings.useCursorCli` to route through the local Cursor
Agent CLI (`cursor-agent` / `agent`). This is not the same runtime as the HTTP
provider adapters: KKTerm first tries an Agent Client Protocol (ACP) stdio
backend — registry adapters for Codex and Claude Agent, or the native
`agent acp` / `cursor-agent acp` server for Cursor. If the ACP adapter is not
available or fails to initialize, KKTerm falls back to the documented one-shot
vendor CLI commands (`codex exec`, `claude -p`, or Cursor `--print --mode=ask`
with a stdin prompt) using the vendor CLI's own cached authentication. Cursor's
fallback must stay in Ask mode and must never pass `--force`. The fallback is
strictly a setup-failure path: once the
ACP `session/prompt` turn has been dispatched, an error or timeout surfaces to
the user instead of re-running the same turn through the one-shot command,
because the ACP agent may already have streamed text or executed kkterm MCP
tools and a re-run would duplicate both. ACP stdio is treated as line-delimited
JSON-RPC with an idle timeout that resets on every received message, so long
agent turns that keep streaming updates (or wait on an in-app tool approval) do
not abort at a fixed wall-clock cutoff; agent-initiated requests are never
mistaken for responses even when their JSON-RPC ids collide with KKTerm's, and
unknown agent requests get a method-not-found reply whether their id is a
number or a string. ACP `session/update` notifications beyond assistant text —
thought chunks, tool-call lifecycle updates, and agent plans — are forwarded to
the same `reasoningDelta` / `toolCallStart` / `toolCallEnd` / `planUpdate`
stream events the native providers emit, so the Assistant work panel renders
CLI-backed turns with the same progress affordances. The API key field is disabled in these modes. Keep this
bridge conservative: use documented ACP or non-interactive CLI modes, avoid
passing KKTerm secrets through environment variables or prompt text, and do not
claim parity with KKTerm's native tool-calling loop unless ACP tool/client
capabilities have been explicitly implemented. ACP-backed CLI sessions attach
KKTerm's built-in `kkterm` MCP server so published safe tools such as
`kkterm.workspace.connections.create` can run through the same bridge used by
external MCP clients. If ACP setup fails and KKTerm falls back to the one-shot
CLI command path, the assistant must return suggestions instead of claiming it
called KKTerm tools.

## Context budgeting

All provider runtimes must route replayed conversation history through the shared
context-budget helper in `src-tauri/src/ai.rs` before building the final provider
request. The helper estimates each known provider/model family's context window
on every turn, but it preserves the original history until the estimated request
crosses the compaction trigger. Once triggered, it keeps the newest turns within a
conservative history budget, truncates oversized individual turns, and emits an
`agent.context_compacted` record to `aiassistant.debug.log` when older turns are
omitted. OpenAI-compatible HTTP providers, the GitHub Copilot SDK bridge, and
ACP/CLI prompts all use this same path so custom providers do not bypass
compaction.

After compaction, usage metadata is recalculated from the retained messages
rather than the original history. Replayed reasoning and compact tool
transcripts count against that retained budget. Provider requests also add an
approximate image cost and the transmitted file payload size when those
attachments are actually sent.

Treat model limits as operational guardrails, not product promises. Exact limits
can drift by model revision and custom OpenAI-compatible endpoints may proxy any
backend, so unknown or self-hosted models must use conservative approximate
defaults and should still preserve the newest user turn. When adding a curated
model family with a well-documented context window, update
`model_context_limit_tokens` and add a prompt/message-boundary regression test.

## Rust provider structure

Rust provider metadata lives under `src-tauri/src/ai/providers/` with one file per
provider. Each OpenAI-compatible provider file must:

1. Be named with snake_case matching the provider kind where possible, for example
   `azure_openai.rs` for `azure-openai`.
2. Import the shared provider metadata types from `super::super`.
3. Export `pub(super) fn provider() -> OpenAiCompatibleProvider`.
4. Fill only provider metadata: `provider_kind`, display `label`,
   `requires_api_key`, `endpoint_style`, `auth_style`, and `default_api`.
5. Avoid request-building or HTTP-client code in the provider file unless the
   provider truly needs a new runtime implementation.

Example shape:

```rust
use super::super::{
    OpenAiApiStyle, OpenAiAuthStyle, OpenAiCompatibleProvider, OpenAiEndpointStyle,
};

pub(super) fn provider() -> OpenAiCompatibleProvider {
    OpenAiCompatibleProvider {
        provider_kind: "example-provider",
        label: "Example Provider",
        requires_api_key: true,
        endpoint_style: OpenAiEndpointStyle::ChatCompletions,
        auth_style: OpenAiAuthStyle::Bearer,
        default_api: OpenAiApiStyle::Responses,
    }
}
```

Then update `src-tauri/src/ai/providers.rs`:

1. Add `mod example_provider;` with the other provider files.
2. Add a `match` arm in `provider_for(kind)` returning
   `Ok(example_provider::provider())`.

This explicit `mod` registration is required by Rust's static source layout. Do
not add `build.rs` code generation, `inventory`-style registration, dynamic
loading, or macro discovery only to make provider files auto-register; those are
not worth the complexity for KKTerm's current provider list. If the team later
chooses a plugin-style provider architecture, document that architecture first.

## Frontend provider registry structure

The Settings UI and frontend validation use `src/ai/providerRegistry/`. For a new
provider:

1. Add `src/ai/providerRegistry/<provider>.ts` exporting a single
   `AiProviderDefinition` constant.
2. Add the provider kind to `AiProviderKind` in `src/types.ts`.
3. Import and append the definition in `src/ai/providerRegistry/index.ts`.
4. Choose `settingsFields` from `src/ai/providerRegistry/shared.ts` rather than
   defining ad hoc field lists when possible.
5. Put durable provider defaults and curated/recommended model choices in
   `src/ai/providerRegistry/modelCatalog.ts`; keep exact/custom model IDs in the
   existing custom model input by setting `allowsCustomModel` appropriately.
6. Set `capabilities` accurately. Use `openAiCompatible` only when the Rust
   provider uses the shared OpenAI-compatible runtime.

Provider labels, API-key labels, and model labels in provider definitions are
currently treated as provider/product names. Any new explanatory user-facing text
outside those names must go through i18n.

### Model catalog review — 2026-09-04

The review below covers every registered provider. Model IDs come from official
documentation or public provider catalogs; no authenticated inference requests
were made. Existing defaults remain unchanged. Recommendations are chat/tool
models compatible with the provider's current KKTerm transport. Account,
deployment, and proxy configuration still determine actual access.

| Provider | Review result | Official sources |
| --- | --- | --- |
| OpenAI | Keep GPT-5.6 Luna, Terra, and Sol. GPT-6 Astra is announced, but the docs say general API access is coming in the following days; do not curate it yet. | [OpenAI model catalog](https://developers.openai.com/api/docs/models), [Astra availability](https://developers.openai.com/api/docs/models/gpt-6-astra) |
| Anthropic | Add `claude-fable-5-1` (Claude Fable 5.1). | [Models overview](https://platform.claude.com/docs/en/models/overview) |
| Cursor | Keep Auto; exact CLI IDs are account-dependent and should come from `agent models`. | [CLI model discovery](https://cursor.com/changelog/cli-jan-08-2026) |
| OpenRouter | Add Fable 5.1, Gemini 3.8 Flash / 3.5 Flash-Lite, GLM-5.3 / Flash, DeepSeek V4 Flash Vision Exp, Qwen3.8 Max / Flash, Nemotron 3.5 Lightning, and MiMo-V2.5 Pro; promote MiniMax M3. Use OpenRouter's dotted `anthropic/claude-fable-5.1` ID. | [Live model catalog](https://openrouter.ai/api/v1/models) |
| Z.ai | Add `glm-5.3` and multimodal `glm-5.3-flash`. | [GLM-5.3](https://docs.z.ai/guides/llm/glm-5.3), [GLM-5.3 Flash](https://docs.z.ai/guides/vlm/glm-5.3-flash) |
| Moonshot AI | Kimi K3 and K2.7 Code / High-Speed are already current. | [Kimi quickstart and current models](https://platform.kimi.ai/docs/overview) |
| DeepSeek | Add `deepseek-v4-flash-vision-exp`; Flash and Pro remain the current text model aliases. The vision entry is explicitly experimental. | [Model details](https://api-docs.deepseek.com/quick_start/pricing/) |
| Gemini | Add `gemini-3.8-flash` and `gemini-3.5-flash-lite`. | [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models) |
| Grok | Grok 4.6 is already the current flagship. | [Grok model catalog](https://docs.x.ai/developers/models) |
| Azure OpenAI | GPT-5.6 is already current; Azure has no documented Astra deployment in this review. | [Azure model availability](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure) |
| LiteLLM | Add `anthropic/claude-fable-5-1` and `gemini/gemini-3.8-flash` as proxy configuration examples; a proxy may expose different deployment aliases. | [Provider model metadata](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json), [Anthropic routing](https://docs.litellm.ai/docs/providers/anthropic) |
| GitHub Copilot | Add Fable 5.1, Opus 5, Gemini 3.8 Flash, and Kimi K3. Preserve the refreshed account catalog as the availability filter. Copilot uses `claude-fable-5.1`. | [Supported models](https://docs.github.com/en/copilot/reference/ai-models/supported-models), [Fable 5.1 rollout](https://github.blog/changelog/2026-09-01-claude-fable-5-1-generally-available-in-github-copilot/), [Gemini 3.8 rollout](https://github.blog/changelog/2026-09-03-gemini-3-8-flash-is-now-available-in-github-copilot/) |
| Ollama | Add local Qwen3.8 and Nemotron 3.5 Lightning. Keep conservative context budgeting because the local daemon's configured context can be smaller than a model's maximum. | [Qwen3.8](https://ollama.com/library/qwen3.8), [Nemotron 3.5 Lightning](https://ollama.com/library/nemotron-3.5-lightning) |
| Ollama Cloud | Add GLM-5.3 / Flash, Kimi K3 / K2.7 Code, MiniMax M3, and the published DeepSeek `:0731` / `:0813` IDs. Demote the unlisted `deepseek-v4-pro` and `qwen3-coder:480b` suggestions. | [Live cloud catalog](https://ollama.com/api/tags), [GLM vision support](https://ollama.com/library/glm-5.3-flash), [MiniMax M3 hosted limit](https://ollama.com/library/minimax-m3) |
| NVIDIA | Add Nemotron 3.5 Lightning and DeepSeek V4 Flash 0731 / Pro 0813. Correct Nano's ID to `nvidia/nemotron-nano-3-30b-a3b` and demote the unlisted Nano VL suggestion. | [Live model catalog](https://integrate.api.nvidia.com/v1/models), [Lightning model card](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/modelcard) |
| OpenCode Go | Add GLM-5.3 / Flash, Kimi K2.7 Code, DeepSeek V4 Flash Vision Exp, LongCat-2.0, and MiMo-V2.5 Pro. The documented Go endpoints for Qwen3.8 / MiniMax M3 use Messages; GPT-5.6 Luna / Grok 4.6 / Muse Spark use Responses. Those additions need a transport change before curation in KKTerm's Chat Completions adapter. | [Go model endpoints](https://opencode.ai/docs/go/), [Live Go catalog](https://opencode.ai/zen/go/v1/models) |
| OpenAI Compatible | Add Fable 5.1 and Gemini 3.8 Flash as configurable gateway examples. Actual model IDs depend on the gateway. | [Claude API IDs](https://platform.claude.com/docs/en/models/overview), [Gemini API IDs](https://ai.google.dev/gemini-api/docs/models) |

New multimodal recommendations must pass the backend image-input gate as well as
the frontend catalog flag. Keep text-only DeepSeek V4 and GLM-5.3 distinct from
their vision variants. Context budgeting uses the hosted limit when it differs:
MiniMax M3 is 512K on Ollama Cloud, and Nemotron 3.5 Lightning is 256K on
OpenRouter versus NVIDIA's documented 1M maximum.

## Persisted settings and secrets

Provider metadata stored in SQLite is non-secret. API keys remain in the OS
keychain under provider-specific AI API key owners. When adding settings:

1. Extend `AiProviderSettings` in both `src-tauri/src/storage.rs` and
   `src/types.ts`.
2. Add frontend defaults in `src/app-defaults.ts` and provider normalization in
   `src/ai/providers.ts`.
3. Keep secrets out of SQLite. Do not add provider-specific API-key fields to the
   durable settings table unless the storage model is redesigned.
4. Add or update storage tests that round-trip the new persisted setting.

The Assistant's Web Search provider follows the same secret boundary. Exa is
the default and calls `https://mcp.exa.ai/mcp?tools=web_search_exa` anonymously
when no key is stored. An optional Exa API key is stored under the dedicated
`exa-search-api-key:exa-search` secret reference and is sent only as the
`x-api-key` header to use the user's higher Exa limits. The regular Exa REST
Search API is not the anonymous path; keep the hosted MCP transport for keyless
search.

`useCodexCli`, `useClaudeCli`, and `useCursorCli` are non-secret booleans. They
are only honored for `openai`, `anthropic`, and `cursor` respectively;
validation clears them for other providers. CLI paths remain optional
non-secret overrides, while CLI auth material stays owned by the vendor CLI.

The generic `openai-compatible` provider exposes `apiMode` so users can choose
Chat Completions or Responses request mode for custom endpoints. The backend
honors this setting only for the generic provider; provider-specific adapters
continue to use their registered default API mode.

The insecure TLS setting is intentionally a provider setting, not a global HTTP
setting. It is off by default and is applied only to AI provider HTTP clients.
The generic `openai-compatible` provider also has a non-secret `extraHeaders`
setting shown as a name/value row editor. The frontend parses legacy
comma-separated `key=value` values, such as `sid=1, "env"="3"`, into rows and
serializes edits back to that backend-compatible format. Recognizable
authorization, token, secret, password, and API-key values are masked by
default with a temporary reveal control; this masking is UI-only. Those
headers are sent with OpenAI-compatible chat, streaming, and model-list
requests for that provider only.

Assistant tool settings are also persisted as non-secret AI provider settings.
`toolPermissionMode` controls whether mutating assistant tools are blocked in
Prompt mode or allowed to execute automatically in Allow All mode. `assistantTools`
controls individual tool families such as web search, shell, Dashboard,
Connections, and Live Sessions. These settings do not grant access to secrets;
Connection passwords, website passwords, SSH passphrases, and AI API keys remain
keychain-owned and are not exposed to tool results.

When changing assistant tools, update both OpenAI-compatible runtime paths in
`src-tauri/src/ai.rs`: Chat Completions-style providers and Responses-style
providers both receive the registered JSON schemas. Mutating tools must be added
to the permission gate so Prompt mode returns a structured `permissionRequired`
result instead of executing. Live Session tools should route through the frontend
bridge because their targets are mounted workspace surfaces, not durable backend
Connection records.

## Localization checklist

For every new user-visible Settings string:

1. Add the English key to `src/i18n/locales/en.json`.
2. Use `t()`/`useTranslation()` in React or `i18next.t()` in pure helpers.
3. Add one `docs/localization_todo/<namespace>.<keyPath>.md` file per new or
   changed English key unless every non-English locale is updated intentionally in
   the same change.

## Assistant Skills

KKTerm ships local Assistant Skills as `SKILL.md` folders under
`assistant-skills/`. They are lightweight workflow guides for the in-app AI
Assistant.

KKTerm ships local Assistant Skills as `SKILL.md` folders under `assistant-skills/`.
They are lightweight workflow guides for the in-app AI Assistant.

### Runtime model

- Packaged skills are bundled as Tauri resources.
- On first skill list or invocation, KKTerm copies missing bundled skill folders into the user app-data folder: `assistant-skills/`.
- Existing user skill folders are not overwritten, so users can edit or replace bundled starter skills.
- Settings -> AI Assistant -> Assistant Skills lists the app-data folder contents.
- Users can open the skills folder, open one skill folder directly, refresh the list, and enable or disable each valid skill.
- The AI Assistant sees enabled skill metadata in the system prompt, decides whether a skill is relevant, and invokes `assistant_use_skill` to load the full `SKILL.md` instructions on demand.
- When a skill is actually loaded, the assistant message work panel shows green `ai.skillInvoked` status text.
- v1 loads instruction text only. `scripts/`, `references/`, and other skill resources are not executed or loaded automatically.
- There is no keyword trigger matcher in the app. Selection is model-driven through the skill invocation tool.

### Skill format

Each skill folder must be named exactly like the `name` field and contain `SKILL.md`:

```markdown
---
name: ssh-troubleshooter
description: Diagnose SSH Connection failures, tmux resume problems, host key warnings, authentication errors, ProxyJump issues, and SFTP-over-SSH startup problems in KKTerm.
---

# SSH Troubleshooter

Use this skill when...
```

Validation rules:

- `name`: lowercase ASCII letters, digits, and hyphens, 1-64 characters.
- `description`: non-empty, at most 1024 characters, no angle brackets.
- Folder name must match `name`.
- Body must contain non-empty instructions.
- Instructions are truncated to 16,000 characters before prompt injection.

### Bundled starter skills

- `dashboard-widget-builder`: Dashboard AI Created Widget creation, repair, layout, data, secrets, and visual polish.
- `dashboard-widget-designer`: Dashboard AI Created Widget visual design, hierarchy, polish, states, and redesign critique.
- `dashboard-data-visualization`: Dashboard metrics, charts, health states, trends, timelines, logs, and data integrity.
- `desktop-accessibility-ui`: Accessible desktop UI and widget review for readability, focus, contrast, motion, and non-color status cues.
- `dns-dhcp-troubleshooter`: DNS lookup, split DNS, stale cache, DHCP lease, gateway, and resolver diagnosis.
- `firewall-port-troubleshooter`: Firewall, NAT, listener, blocked port, and service binding diagnosis.
- `network-connectivity-troubleshooter`: General reachability, routing, gateway, VPN, proxy, packet loss, latency, and MTU diagnosis.
- `remote-desktop-helper`: RDP/VNC setup, screenshots, input, focus, sizing, and troubleshooting.
- `sftp-transfer-helper`: SFTP browsing, upload/download planning, conflicts, permissions, and paths.
- `ssh-troubleshooter`: SSH Connection, authentication, host key, ProxyJump, tmux, and SFTP startup diagnosis.
- `terminal-command-planner`: Safe terminal command planning for local shells, SSH, PowerShell, Command Prompt, WSL, and diagnostics.
- `tls-certificate-troubleshooter`: TLS, HTTPS certificate, hostname mismatch, chain, trust root, SNI, and WebView2 URL Connection diagnosis.

### Adding bundled skills

1. Add `assistant-skills/<skill-name>/SKILL.md`.
2. Add the file to `src-tauri/tauri.conf.json` under `bundle.resources`.
3. Run `cargo test --manifest-path src-tauri/Cargo.toml assistant_skills --lib`.
4. Update `docs/manual/13-ai-assistant.md` and `docs/manual/15-settings.md` when user-facing behavior changes.
