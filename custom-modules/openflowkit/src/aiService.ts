import { getSystemInstruction, type ChatMessage } from '@/services/geminiService';
import { getClaudeContent, getOpenAICompatibleContent } from '@/services/aiServiceSchemas';
import { err, ok, type Result } from '@/lib/result';

export type AIProvider = 'gemini' | 'openai' | 'claude' | 'groq' | 'nvidia' | 'cerebras' | 'mistral' | 'openrouter' | 'ollama' | 'custom';

interface HostAiOpened { token: string }
interface HostAiRead { delta: string; done: boolean; providerKind?: string; model?: string }
interface HostAiRequest {
  prompt: string;
  systemInstruction?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  imageDataUrl?: string;
}

declare global {
  interface Window {
    KKTerm: {
      readonly apiVersion: number;
      readonly context: { theme: string; locale: string };
      ready(): Promise<boolean>;
      getContext(): Promise<{ theme: string; locale: string }>;
      on(event: string, listener: (detail: unknown) => void): () => boolean;
      ai: {
        open(request: HostAiRequest): Promise<HostAiOpened>;
        read(token: string): Promise<HostAiRead>;
        cancel(token: string): Promise<boolean>;
        openSettings(): Promise<boolean>;
      };
    };
  }
}

function historyToMessages(history: ChatMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return history.map((message) => ({
    role: message.role === 'model' ? 'assistant' : 'user',
    content: message.parts.map((part) => part.text || '').join(''),
  }));
}

async function streamHostAi(
  request: HostAiRequest,
  onChunk?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!window.KKTerm?.ai) throw new Error('KKTerm host AI is unavailable.');
  const { token } = await window.KKTerm.ai.open(request);
  const cancel = (): void => { void window.KKTerm.ai.cancel(token); };
  signal?.addEventListener('abort', cancel, { once: true });
  let output = '';
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('The AI request was cancelled.', 'AbortError');
      const result = await window.KKTerm.ai.read(token);
      if (result.delta) {
        output += result.delta;
        onChunk?.(result.delta);
      }
      if (result.done) return output;
      if (!result.delta) await new Promise((resolve) => window.setTimeout(resolve, 20));
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

export async function generateDiagramFromChat(
  history: ChatMessage[],
  newMessage: string,
  currentDSL?: string,
  imageBase64?: string,
  _apiKeySetting?: string,
  _modelIdSetting?: string,
  _provider: AIProvider = 'gemini',
  _customBaseUrlSetting?: string,
  isEditMode = false,
  onChunk?: (delta: string) => void,
  signal?: AbortSignal,
  _temperature?: number,
): Promise<string> {
  const prompt = isEditMode && currentDSL
    ? `User Request: ${newMessage}\n\nCURRENT DIAGRAM — output the complete updated OpenFlow DSL:\n${currentDSL}\n\nIMPORTANT: Preserve ALL unchanged node IDs and attributes exactly. Only modify what was requested.`
    : `User Request: ${newMessage}\n\nGenerate a new OpenFlow DSL diagram.`;
  return streamHostAi({
    prompt,
    systemInstruction: getSystemInstruction(isEditMode ? 'edit' : 'create'),
    messages: historyToMessages(history),
    imageDataUrl: imageBase64,
  }, onChunk, signal);
}

export async function chatWithDocs(
  history: ChatMessage[],
  newMessage: string,
  docsContext: string,
): Promise<string> {
  return streamHostAi({
    prompt: newMessage,
    systemInstruction: `You are an expert support assistant for OpenFlowKit. Answer only from this documentation; if it does not contain the answer, say so.\n\nDOCUMENTATION:\n${docsContext}`,
    messages: historyToMessages(history),
  });
}

export async function chatWithFlowpilot(
  history: ChatMessage[],
  newMessage: string,
  systemInstruction: string,
  _apiKeySetting?: string,
  _modelIdSetting?: string,
  _provider: AIProvider = 'gemini',
  _customBaseUrlSetting?: string,
  onChunk?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  return streamHostAi({
    prompt: newMessage,
    systemInstruction,
    messages: historyToMessages(history),
  }, onChunk, signal);
}

interface AiServiceError { code: 'bad_response'; message: string }

function parseOpenAICompatibleContent(data: unknown): Result<string, AiServiceError> {
  const text = getOpenAICompatibleContent(data);
  return typeof text === 'string' && text.trim()
    ? ok(text)
    : err({ code: 'bad_response', message: 'No content in response from AI provider.' });
}

function parseClaudeContent(data: unknown): Result<string, AiServiceError> {
  const text = getClaudeContent(data);
  return typeof text === 'string' && text.trim()
    ? ok(text)
    : err({ code: 'bad_response', message: 'No content in Anthropic response.' });
}

export type { ChatMessage };
export { parseClaudeContent, parseOpenAICompatibleContent };
