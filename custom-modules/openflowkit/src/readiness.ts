import type { AISettings } from '@/store';

export interface AIReadinessMessage {
  tone: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
}

export interface AIReadinessState {
  canGenerate: boolean;
  blockingIssue: AIReadinessMessage | null;
  advisory: AIReadinessMessage | null;
}

export function getAIReadinessState(_aiSettings: AISettings): AIReadinessState {
  return { canGenerate: true, blockingIssue: null, advisory: null };
}
