import React from 'react';
import { Bot, ExternalLink } from 'lucide-react';

export function AISettings(): React.ReactElement {
  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-brand-border)] bg-[var(--brand-background)] p-4">
        <div className="flex items-start gap-3">
          <Bot className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand-primary)]" />
          <div>
            <h3 className="text-sm font-semibold text-[var(--brand-text)]">AI is managed by KKTerm</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--brand-secondary)]">
              OpenFlowKit uses KKTerm's selected provider and model. Provider credentials remain in KKTerm and are never shared with this Module.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--brand-primary)] px-3 py-2 text-xs font-semibold text-white"
          onClick={() => { void window.KKTerm.ai.openSettings(); }}
        >
          Open KKTerm AI Settings
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
