// Watchdog report generation: AI summary + Markdown export.
//
// Two on-demand actions surfaced from the detail view:
// 1. Summarize — runs an isolated AI turn over the report data, returns
//    natural-language text shown inline.
// 2. Save report — writes the structured report (plus AI summary if
//    generated) as Markdown via the existing save dialog.
//
// Neither persists state in Rust — summaries live in the store until
// dismissed; saved Markdown is whatever the user keeps on disk.

import { invoke } from "@tauri-apps/api/core";
import { invokeCommand, isTauriRuntime, pickAndSaveFile } from "../lib/tauri";
import type { WatchdogReport, WatchdogState } from "./types";

interface AiAgentResponse {
  providerKind: string;
  model: string;
  content: string;
}

/// Build the prompt + system context for the summary sub-turn, invoke the
/// model, and return the text. Throws on failure (caller handles UI).
export async function generateAiSummary(report: WatchdogReport): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("AI summary requires the Tauri runtime.");
  }
  const systemContext = [
    `WATCHDOG SUMMARY REQUEST.`,
    `You are summarizing the lifecycle of a single watchdog session for a human reviewer.`,
    `Write a concise post-mortem (3–6 sentences). Cover: what the watchdog was watching, what triggered it (if anything), what intervention sub-turns did (if any), and the final outcome.`,
    `Do not invent details that aren't present in the report JSON. Do not propose next steps unless the report data clearly suggests one.`,
    `Use plain prose. No bullet lists, no headers. The reader is reviewing a Markdown report and will read your text as the conclusion section.`,
  ].join("\n");

  const prompt = [
    "Summarize this watchdog report:",
    "",
    "```json",
    JSON.stringify(condenseForPrompt(report), null, 2),
    "```",
  ].join("\n");

  const response = await invoke<AiAgentResponse>("run_ai_agent", {
    request: {
      prompt,
      contextLabel: `watchdog:${report.id}:summary`,
      intent: "chat",
      allowTools: false,
      messages: [],
      systemContext,
    },
  });
  return (response.content ?? "").trim();
}

/// Trim the report into a token-friendly subset before handing it to the AI.
/// Ticks are summarized as count + first/last/min/max rather than the full
/// 200-entry array so the prompt stays compact.
function condenseForPrompt(report: WatchdogReport): unknown {
  const numericTickValues = report.ticks
    .map((t) => (typeof t.value === "number" ? t.value : null))
    .filter((v): v is number => v !== null);
  const tickSummary = numericTickValues.length === 0
    ? { count: report.ticks.length, note: "non-numeric values" }
    : {
        count: numericTickValues.length,
        first: numericTickValues[0],
        last: numericTickValues[numericTickValues.length - 1],
        min: Math.min(...numericTickValues),
        max: Math.max(...numericTickValues),
      };
  return {
    name: report.name,
    state: report.state,
    config: {
      target: report.config.target,
      trigger: report.config.trigger,
      pollMs: report.config.pollMs,
      stop: report.config.stop,
      action: report.config.action,
    },
    ticks: tickSummary,
    triggerCount: report.triggers.length,
    triggers: report.triggers.slice(-5),
    interventionCount: report.interventions.length,
    interventions: report.interventions,
  };
}

/// Compose the full Markdown report and pop the save dialog. Returns the
/// chosen path (or null if cancelled). Includes the AI summary inline if
/// provided.
export async function saveReportAsMarkdown(
  report: WatchdogReport,
  aiSummary: string | null,
): Promise<string | null> {
  const markdown = renderMarkdown(report, aiSummary);
  const bytes = new TextEncoder().encode(markdown);
  const filename = `${slugify(report.name || "watchdog")}-${report.id}.md`;
  return pickAndSaveFile(filename, bytes, [
    { name: "Markdown", extensions: ["md"] },
  ]);
}

function renderMarkdown(report: WatchdogReport, aiSummary: string | null): string {
  const lines: string[] = [];
  lines.push(`# Watchdog report: ${report.name || report.id}`);
  lines.push("");
  lines.push(`- **ID:** \`${report.id}\``);
  lines.push(`- **Created:** ${formatTime(report.createdAt)}`);
  lines.push(`- **Final state:** ${describeState(report.state)}`);
  lines.push(`- **Poll interval:** ${report.config.pollMs} ms`);
  lines.push(`- **Triggers:** ${report.triggers.length}`);
  lines.push(`- **Interventions:** ${report.interventions.length}`);
  lines.push("");

  lines.push("## Configuration");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(report.config, null, 2));
  lines.push("```");
  lines.push("");

  if (report.triggers.length > 0) {
    lines.push("## Trigger events");
    lines.push("");
    lines.push("| Time | Value at trigger |");
    lines.push("|------|------------------|");
    for (const trig of report.triggers) {
      lines.push(`| ${formatTime(trig.at)} | \`${JSON.stringify(trig.valueAtTrigger)}\` |`);
    }
    lines.push("");
  }

  if (report.interventions.length > 0) {
    lines.push("## Interventions");
    lines.push("");
    for (const intv of report.interventions) {
      lines.push(`### \`${intv.interventionId}\` — ${formatTime(intv.at)}`);
      lines.push("");
      lines.push(`- **Outcome:** ${intv.ok ? "ok" : "error"}`);
      if (intv.toolCalls && intv.toolCalls.length > 0) {
        lines.push(`- **Tools called:** ${intv.toolCalls.map((t) => `\`${t}\``).join(", ")}`);
      }
      if (intv.completionReason) {
        lines.push(`- **Completion declared:** ${intv.completionReason}`);
      }
      if (intv.error) {
        lines.push(`- **Error:** ${intv.error}`);
      }
      lines.push("");
      lines.push(`> ${intv.summary.replace(/\n/g, "\n> ")}`);
      lines.push("");
    }
  }

  // Ticks: include count + min/max/last; full per-tick table for short
  // histories. Beyond 60 entries, append a hint that more were trimmed —
  // keeps the Markdown reasonable for visual inspection.
  lines.push("## Ticks");
  lines.push("");
  const numericTicks = report.ticks.filter((t) => typeof t.value === "number");
  if (numericTicks.length > 0) {
    const values = numericTicks.map((t) => t.value as number);
    lines.push(`- **Count:** ${report.ticks.length}`);
    lines.push(`- **Min:** ${Math.min(...values)}`);
    lines.push(`- **Max:** ${Math.max(...values)}`);
    lines.push(`- **Last:** ${values[values.length - 1]}`);
    lines.push("");
  } else {
    lines.push(`- **Count:** ${report.ticks.length} (non-numeric values)`);
    lines.push("");
  }
  const displayed = report.ticks.slice(-60);
  if (displayed.length > 0) {
    lines.push(`<details><summary>Last ${displayed.length} ticks</summary>`);
    lines.push("");
    lines.push("| Time | Value | Predicate met |");
    lines.push("|------|-------|----------------|");
    for (const t of displayed) {
      lines.push(
        `| ${formatTime(t.at)} | \`${JSON.stringify(t.value)}\` | ${t.predicateMet ? "✓" : ""} |`,
      );
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  if (aiSummary) {
    lines.push("## AI summary");
    lines.push("");
    lines.push(aiSummary);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(`_Generated by KKTerm at ${new Date().toISOString()}._`);
  return lines.join("\n");
}

function describeState(state: WatchdogState): string {
  switch (state.kind) {
    case "armed":
    case "running":
      return state.kind;
    case "triggered":
      return `triggered (×${state.triggerCount})`;
    case "intervening":
      return `intervening`;
    case "suppressed":
      return `suppressed`;
    case "completed":
      return `completed (${state.reason})`;
    case "canceled":
      return "canceled";
    case "error":
      return `error: ${state.message}`;
    default:
      return JSON.stringify(state);
  }
}

function formatTime(unixMs: number): string {
  return new Date(unixMs).toISOString();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "watchdog";
}

/// Re-export so the store can fetch a full report on demand for the
/// summary action without duplicating the IPC call shape.
export async function fetchReport(id: string): Promise<WatchdogReport | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invokeCommand("watchdog_get_report", { id });
  } catch {
    return null;
  }
}
