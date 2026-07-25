import { ChevronDown, ChevronRight, LoaderCircle } from "../lib/reicon";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18next from "../i18n/config";
import { ariaExpanded } from "../lib/aria";
import { openExternalUrl } from "../lib/tauri";
import { writeToClipboard } from "../lib/clipboard";
import type { AssistantChatMessage } from "./assistantTypes";
import { MarkdownContent } from "./AssistantMarkdownContent";
import {
  humanizeAssistantToolName,
  toolCallLabel,
} from "./assistantToolLabels";
import {
  assistantWorkPanelStatusKind,
  assistantWorkPanelShouldShowThinkingStep,
  latestRunningAssistantToolCall,
} from "./streamMessage";
import { AssistantKineticText, AssistantWaitingDots } from "./AssistantKineticText";

export function AssistantWorkPanel({ message }: { message: AssistantChatMessage }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [waitingPhrase, setWaitingPhrase] = useState<string>(() => randomAssistantWaitingPhrase());
  const wasStreamingRef = useRef(Boolean(message.isStreaming));
  const reasoningContent = message.reasoningContent?.trim() ?? "";
  const toolCalls = message.toolCalls ?? [];
  const skillNames = message.skillNames ?? [];
  const modelPlan = message.runManifest?.source === "model" ? message.runManifest : undefined;
  const hasWork =
    Boolean(reasoningContent) ||
    toolCalls.length > 0 ||
    skillNames.length > 0 ||
    Boolean(modelPlan) ||
    Boolean(message.isStreaming);
  const shouldShowThinkingStep = assistantWorkPanelShouldShowThinkingStep(message);

  useEffect(() => {
    // Reset only when a new message arrives; isStreaming transitions are handled below.
    setExpanded(false);
    wasStreamingRef.current = Boolean(message.isStreaming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  useEffect(() => {
    if (wasStreamingRef.current && !message.isStreaming) {
      setExpanded(false);
    }
    wasStreamingRef.current = Boolean(message.isStreaming);
  }, [message.isStreaming]);

  useEffect(() => {
    if (!message.isStreaming) {
      return;
    }

    setWaitingPhrase((currentPhrase) => randomAssistantWaitingPhrase(currentPhrase));
    const interval = window.setInterval(() => {
      setWaitingPhrase((currentPhrase) => randomAssistantWaitingPhrase(currentPhrase));
    }, 3000);

    return () => {
      window.clearInterval(interval);
    };
  }, [message.isStreaming]);

  if (!hasWork) {
    return null;
  }

  const duration =
    message.workStartedAt && message.workCompletedAt
      ? formatAssistantWorkDuration(message.workStartedAt, message.workCompletedAt, t)
      : "";
  const latestToolCall = latestRunningAssistantToolCall(message);
  const statusKind = assistantWorkPanelStatusKind(message);
  const label =
    statusKind === "tool" && latestToolCall
      ? t("ai.toolCallUsing", {
          tool: humanizeAssistantToolName(latestToolCall.toolName),
        })
      : statusKind === "skill"
        ? t("ai.skillInvoked", { skills: skillNames.map(humanizeAssistantToolName).join(", ") })
        : statusKind === "waiting"
          ? waitingPhrase || t("ai.chargingBeacon")
          : t("ai.workedFor", { duration: duration || t("ai.workDurationUnderSecond") });
  const thinkingStatus = message.isStreaming ? "running" : "completed";

  return (
    <section className="assistant-work-panel">
      <button
        {...ariaExpanded(expanded)}
        className="assistant-work-toggle"
        onClick={() => setExpanded((e) => !e)}
        type="button"
      >
        <span className="assistant-work-status">
          <AssistantKineticText
            repel={statusKind === "waiting"}
            text={label}
            tone={statusKind === "tool" ? "tool" : statusKind === "skill" ? "skill" : "waiting"}
          />
          {message.isStreaming ? <AssistantWaitingDots /> : null}
        </span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded ? (
        <div className="assistant-work-timeline">
          {modelPlan ? (
            <div className="assistant-work-step" data-state="plan">
              <span className="assistant-work-step-icon" aria-hidden="true" />
              <div>
                <strong>{t("ai.workPlanTitle")}</strong>
                {modelPlan.goal ? <small>{modelPlan.goal}</small> : null}
                <ul className="assistant-work-plan-steps">
                  {modelPlan.steps.map((step) => (
                    <li data-state={step.status} key={step.id}>
                      <span>{step.label}</span>
                      {step.detail ? <small>{step.detail}</small> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          {shouldShowThinkingStep ? (
            <div className="assistant-work-step" data-state={thinkingStatus}>
              <span className="assistant-work-step-icon" aria-hidden="true">
                {message.isStreaming ? <LoaderCircle size={13} /> : null}
              </span>
              <div>
                <strong>{t("ai.thinkingStep")}</strong>
                {reasoningContent ? (
                  <div className="assistant-work-reasoning">
                    <MarkdownContent
                      canSendCode={false}
                      content={reasoningContent}
                      onCopyCode={(code) => {
                        void writeToClipboard(code);
                      }}
                      onOpenLink={(url) => {
                        void openExternalUrl(url);
                      }}
                      onSendCode={() => undefined}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {skillNames.map((skillName) => (
            <div className="assistant-work-step" data-state="skill" key={skillName}>
              <span className="assistant-work-step-icon" aria-hidden="true" />
              <div>
                <strong>
                  <AssistantKineticText
                    text={t("ai.skillInvoked", {
                      skills: humanizeAssistantToolName(skillName),
                    })}
                    tone="skill"
                  />
                </strong>
              </div>
            </div>
          ))}
          {toolCalls.map((toolCall) => (
            <div className="assistant-work-step" data-state={toolCall.status} key={toolCall.toolId}>
              <span className="assistant-work-step-icon" aria-hidden="true">
                {toolCall.status === "running" ? <LoaderCircle size={13} /> : null}
              </span>
              <div>
                <strong>
                  <AssistantKineticText
                    text={toolCallLabel(toolCall.toolName, toolCall.status, t)}
                    tone="tool"
                  />
                </strong>
                <small>
                  {toolCall.status === "running" ? t("ai.toolCallRunning") : t("ai.toolCallComplete")}
                </small>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function randomAssistantWaitingPhrase(previousPhrase?: string) {
  const phrases = i18next.t("ai.waitingPhrases", { returnObjects: true }) as readonly string[];
  if (!Array.isArray(phrases) || phrases.length === 0) {
    return i18next.t("ai.chargingBeacon");
  }
  const candidates = phrases.filter((phrase) => phrase !== previousPhrase);
  const phrasePool = candidates.length > 0 ? candidates : phrases;
  return phrasePool[Math.floor(Math.random() * phrasePool.length)] ?? i18next.t("ai.chargingBeacon");
}

function formatAssistantWorkDuration(
  startedAt: string,
  completedAt: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const started = new Date(startedAt).getTime();
  const completed = new Date(completedAt).getTime();
  if (Number.isNaN(started) || Number.isNaN(completed) || completed <= started) {
    return t("ai.workDurationUnderSecond");
  }
  const totalSeconds = Math.max(1, Math.round((completed - started) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return t("ai.workDurationSeconds", { count: seconds });
  }
  return t("ai.workDurationMinutesSeconds", { minutes, seconds });
}
