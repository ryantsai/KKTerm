import {
  assistantWorkPanelStatusKind,
  assistantWorkPanelShouldShowThinkingStep,
  latestRunningAssistantToolCall,
  completeAssistantStreamMessageFromResponse,
  type AssistantStreamMessage,
} from "./streamMessage.ts";

const secretRequest = [
  "```kkterm-secret-request",
  JSON.stringify({
    kind: "widgetSecret",
    ownerId: "dashboard-widget-secret:inst-1:apiKey",
    label: "API key",
  }),
  "```",
].join("\n");

const streamingMessage: AssistantStreamMessage = {
  content: `Working...\n\n${secretRequest}`,
};

const completed = completeAssistantStreamMessageFromResponse(streamingMessage, {
  providerKind: "openai",
  model: "test",
  content: "Secret entry requested.",
});

if (!completed.content.includes("Secret entry requested.")) {
  throw new Error("Final assistant content should be preserved.");
}

if (!completed.content.includes(secretRequest)) {
  throw new Error("Secret request directives emitted during streaming must survive finalization.");
}

const streamingWithTool: AssistantStreamMessage = {
  content: "",
  isStreaming: true,
  toolCalls: [
    {
      toolId: "call-1",
      toolName: "web_search",
      status: "running",
      startedAt: "2026-05-18T00:00:00.000Z",
    },
  ],
};

if (latestRunningAssistantToolCall(streamingWithTool)?.toolName !== "web_search") {
  throw new Error("The work panel summary should use the active running tool.");
}

if (
  latestRunningAssistantToolCall({
    ...streamingWithTool,
    toolCalls: streamingWithTool.toolCalls?.map((toolCall) => ({
      ...toolCall,
      status: "completed",
    })),
  })
) {
  throw new Error("Completed tool calls should not replace the waiting phrase.");
}

if (
  assistantWorkPanelStatusKind({
    content: "Done.",
    isStreaming: false,
    skillNames: ["terminal-command-planner"],
  }) !== "completed"
) {
  throw new Error("Completed assistant work should not retain the live skill indication.");
}

if (
  assistantWorkPanelStatusKind({
    content: "",
    isStreaming: true,
    skillNames: ["terminal-command-planner"],
  }) !== "skill"
) {
  throw new Error("A skill indication should remain live while the assistant is streaming.");
}

if (assistantWorkPanelShouldShowThinkingStep(streamingWithTool)) {
  throw new Error("The thinking step should not render without reasoning text.");
}

if (
  !assistantWorkPanelShouldShowThinkingStep({
    ...streamingWithTool,
    reasoningContent: "Checking what tool is needed.",
  })
) {
  throw new Error("The thinking step should render when reasoning text is available.");
}
