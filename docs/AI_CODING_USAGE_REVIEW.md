# AI Coding Usage compatibility review

Reviewed: **2026-09-18**. Baseline: `876702562fc4a7c22d5ee2c8cd8ddecc356819ba`.

This is a source/documentation review, not a successful authenticated smoke test. No provider account was queried and no billable model request was made. Antigravity, Grok Build, and Copilot remain research candidates, not selectable providers in this change.

## Existing integrations

### Codex

The official [app-server documentation](https://learn.chatgpt.com/docs/app-server) still specifies `account/read` and `account/rateLimits/read`. Responses can include both the legacy `rateLimits` value and `rateLimitsByLimitId`, and windows declare their duration. The documentation's examples are not a promise that every primary window lasts five hours.

The implementation now selects only the base `codex` bucket. Model-specific, code-review, credits, and other nested objects cannot fill an absent base quota. Explicit durations must match the existing fixed five-hour/weekly slots; different or malformed durations remain unknown. Missing duration retains the legacy primary/secondary interpretation. An absent window is never presented as zero usage.

Refresh now uses the account-bound app-server before the existing direct fallback. Unbound local rollout events are no longer treated as current-account quota, even when recent: signing into another account does not prove that the last rollout belongs to it. Old rollout-derived SQLite snapshots are ignored, and old direct snapshots are re-normalized on load. The SQLite cache remains available on whole-refresh failure without changing its account label or capture time.

API-key/cloud authentication is not treated as ChatGPT subscription authentication. The direct fallback requires OAuth credentials and never substitutes `OPENAI_API_KEY`. Known app-server authentication failures do not fall back to another credential source.

**Remaining limitation:** direct `/backend-api/wham/usage` is a best-effort compatibility fallback, not a verified public API contract. Nonstandard window durations, separate model buckets, and credits need a richer display model rather than fabricated five-hour/weekly values.

### Claude Code

The [CLI reference](https://code.claude.com/docs/en/cli-reference) documents JSON as the default output of `claude auth status`. KKTerm now uses that form, rejects malformed/negative authentication output, and only attempts subscription quota for `claude.ai` authentication.

The [authentication documentation](https://code.claude.com/docs/en/authentication) describes platform-specific credential storage and `CLAUDE_CONFIG_DIR`. The file lookup now respects that directory without falling back to a different profile. The CLI's credential-file fallback is supported on macOS as well as Windows/Linux.

**Remaining limitations:** native macOS Keychain-only credentials are not read by this collector. Do not export them to a plaintext file as a workaround. The existing `/api/oauth/usage` endpoint and beta/User-Agent behavior remain best effort; this review did not establish a supported public contract or authenticate against that endpoint. A successful CLI login does not guarantee quota availability.

A better follow-up is an explicitly enabled adapter for the documented [status-line JSON](https://code.claude.com/docs/en/statusline): `rate_limits.five_hour` and `rate_limits.seven_day` expose utilization and reset times when available. Missing fields must stay unknown. This is provider-produced telemetry, not an always-live polling endpoint. Installation must preserve the user's existing status-line command and remain opt-in; it is not installed by this PR.

## Freshness and failure handling

`lastRefreshAt` now describes the displayed snapshot's capture time. New optional `lastAttemptAt` controls polling/backoff and is backed by the existing account-table timestamp, so no schema migration is required. A failed request no longer makes stale quota look freshly captured. Whole-refresh failures retain the old account and snapshot together; an authenticated update with no quota clears the old snapshot before relabeling, because identity/organization binding cannot otherwise be guaranteed. Reset windows are invalidated on load, including offline loads.

Claude retry handling accepts both delta-seconds and HTTP-date `Retry-After`. Legacy state without an attempt timestamp falls back to the prior timestamp. State with no usable timestamp can retry to establish one instead of advancing its cooldown forever. Existing five-minute Codex and fifteen-minute Claude background intervals are unchanged.

## Other provider candidates

| Provider | Verified surface | Integration recommendation |
| --- | --- | --- |
| Google Antigravity | Official [`/usage` documentation](https://antigravity.google/docs/cli/commands/usage) describes interactive model-quota display and the `/quota` alias. [Plan changes](https://antigravity.google/blog/changes-to-antigravity-plans) distinguish shared Gemini usage, non-Gemini allowance, and credit behavior. | Promising quota candidate, but the reviewed pages did not establish a supported noninteractive JSON quota API. Require a documented export or explicitly supported local interface; do not scrape browser credentials or silently depend on private language-server endpoints. Preserve model pools and resets separately. |
| Grok Build | Official [commands](https://docs.x.ai/build/modes-and-commands) include `/usage` for credit usage/billing. [Status-line documentation](https://docs.x.ai/build/features/status-line) describes script JSON and session/context information; the [CLI reference](https://docs.x.ai/build/cli/reference) includes headless/session tooling. | Session telemetry is a plausible first adapter. Context-window utilization and session cost are not subscription quota. The reviewed docs did not establish a noninteractive quota endpoint. Never run a headless model prompt merely to refresh a usage widget. |
| GitHub Copilot | Official [billing usage REST reference](https://docs.github.com/en/rest/billing/usage) and [reporting tutorial](https://docs.github.com/en/billing/tutorials/automate-usage-reporting) document user/org/enterprise AI-credit usage reporting. | Strongest additional provider candidate for an API-backed credit/spend panel. Request the correct billing permission and account scope. Personal endpoints exclude organization-billed licenses. Do not assume an ordinary repository connection can access billing or that billing reports are real-time quota. |

Copilot's [current organization billing model](https://docs.github.com/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises) uses AI credits; [legacy premium-request documentation](https://docs.github.com/copilot/how-tos/monitoring-your-copilot-usage-and-entitlements) explicitly has a narrower audience. Do not hard-code an old monthly premium-request allowance for every account.

“Not established in reviewed docs” is not a claim that no private or future interface exists. New adapters need actual response fixtures and authenticated smoke tests before being offered as working integrations.

## Extension shape and priority

Before adding provider names, extend the data model to a collection of metrics with explicit kind (`quotaPercent`, `creditBalance`, `spend`, `sessionTokens`, `contextPercent`), provider bucket/model pool, window duration, reset time, unit/currency, source, account binding, capture time, attempt time, and availability. Unknown, expired, unsupported, and zero are different states. Keep quota and session telemetry visually separate.

Recommended order: (1) opt-in Claude status-line telemetry to reduce private-endpoint dependence; (2) Copilot AI-credit reporting with explicit billing authorization; (3) Antigravity once its machine-readable quota surface is verified; (4) Grok Build session telemetry, then account quota only with a verified contract. Do not overwrite CLI settings, persist tokens in widget state, refresh OAuth outside the owning CLI, or make model calls just to collect usage.

## Validation

Executed in a reconstructed, hash-verified source subset, not a full repository checkout:

- `node --test tests/ai-coding-usage-refresh-policy.test.mjs`: **10 passed** (four existing plus six new).
- Focused `tsc --strict --noEmit --target es2022 --module esnext` on `types.ts` and `refreshPolicy.ts`: **passed**.
- `git diff --check`: **passed** for the local backend diff.

Added **15 Rust regression tests** for bucket selection, duration handling, credential mode, strict auth parsing, custom config paths, retry dates, UTF-8 errors, and SQLite cache freshness/account isolation. They were **not executed**: this environment lacks Rust/Cargo and the complete native build dependencies. Full `pnpm run check`, `pnpm run build`, Rust tests/formatting, and Windows/macOS/Linux authenticated smoke tests remain required before merge. Neither new-provider support nor end-to-end runtime compatibility is claimed by these focused checks.
