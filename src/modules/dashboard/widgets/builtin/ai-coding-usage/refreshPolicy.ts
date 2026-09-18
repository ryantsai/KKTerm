import type { AiCodingUsageProviderState } from "./types";

export const AI_CODING_USAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
// The Claude usage endpoint rate-limits aggressively and does not recover
// quickly once tripped, so background polling stays well below the reported
// safe cadence. Manual refresh is still allowed outside 429 cooldowns.
export const CLAUDE_USAGE_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
export const CLAUDE_USAGE_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

export function providersDueForAiCodingUsageRefresh(
  providers: AiCodingUsageProviderState[],
  nowMs = Date.now(),
) {
  return providers.filter((provider) =>
    isAiCodingUsageRefreshAllowed(provider, nowMs),
  );
}

export function providersDueForAiCodingUsageBackgroundRefresh(
  providers: AiCodingUsageProviderState[],
  nowMs = Date.now(),
) {
  return providers.filter(
    (provider) =>
      isAiCodingUsageRefreshAllowed(provider, nowMs) &&
      isAiCodingUsageRefreshStale(provider, nowMs),
  );
}

export function isAiCodingUsageRefreshAllowed(
  provider: AiCodingUsageProviderState,
  nowMs = Date.now(),
) {
  if (provider.authState !== "connected") {
    return false;
  }
  const retryAt = nextAiCodingUsageRefreshAt(provider, nowMs);
  return retryAt === null || nowMs >= retryAt;
}

export function nextAiCodingUsageRefreshAt(
  provider: AiCodingUsageProviderState,
  nowMs = Date.now(),
) {
  if (provider.provider !== "claudeCode" || !isClaudeUsageRateLimitError(provider.lastError)) {
    return null;
  }
  const lastAttemptMs = refreshAttemptTimestampMs(provider);
  if (lastAttemptMs === null) {
    // Legacy/corrupt state has no stable anchor. Permit a retry to establish
    // one instead of moving the deadline forward forever on every evaluation.
    return nowMs;
  }
  return lastAttemptMs + claudeUsageRateLimitCooldownMs(provider.lastError, lastAttemptMs);
}

function claudeUsageRateLimitCooldownMs(
  message: string | null | undefined,
  lastAttemptMs: number,
) {
  const retryAfter = message?.match(/retry after\s+(.+?)(?:\.$|$)/i)?.[1].trim();
  if (!retryAfter) {
    return CLAUDE_USAGE_RATE_LIMIT_COOLDOWN_MS;
  }
  const secondsMatch = retryAfter.match(/^(\d+)\s*(?:s|sec|second|seconds)?$/i);
  if (secondsMatch) {
    const seconds = Number(secondsMatch[1]);
    const delayMs = seconds * 1000;
    return Number.isFinite(delayMs)
      ? Math.max(delayMs, CLAUDE_USAGE_REFRESH_INTERVAL_MS)
      : CLAUDE_USAGE_RATE_LIMIT_COOLDOWN_MS;
  }
  // HTTP Retry-After also permits an absolute date.
  const retryAt = Date.parse(retryAfter);
  return Number.isNaN(retryAt)
    ? CLAUDE_USAGE_RATE_LIMIT_COOLDOWN_MS
    : Math.max(retryAt - lastAttemptMs, CLAUDE_USAGE_REFRESH_INTERVAL_MS);
}

function isClaudeUsageRateLimitError(message?: string | null) {
  return Boolean(message?.match(/HTTP\s+429|Too Many Requests/i));
}

function isAiCodingUsageRefreshStale(
  provider: AiCodingUsageProviderState,
  nowMs: number,
) {
  const lastAttemptMs = refreshAttemptTimestampMs(provider);
  return (
    lastAttemptMs === null ||
    nowMs - lastAttemptMs > aiCodingUsageRefreshIntervalMs(provider)
  );
}

function refreshAttemptTimestampMs(provider: AiCodingUsageProviderState) {
  return parseTimestampMs(provider.lastAttemptAt) ?? parseTimestampMs(provider.lastRefreshAt);
}

function aiCodingUsageRefreshIntervalMs(provider: AiCodingUsageProviderState) {
  return provider.provider === "claudeCode"
    ? CLAUDE_USAGE_REFRESH_INTERVAL_MS
    : AI_CODING_USAGE_REFRESH_INTERVAL_MS;
}

function parseTimestampMs(value?: string | null) {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
