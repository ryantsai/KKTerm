# AI Provider Integration Guide

This guide describes the expected structure for adding AI providers to KKTerm.
It covers the Rust agent runner, the TypeScript Settings/provider registry, and
localization follow-up.

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
setting for simple comma-separated `key=value` request headers, such as
`sid=1, "env"="3"`. Those headers are sent with OpenAI-compatible chat,
streaming, and model-list requests for that provider only.

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
