import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';

export function SidebarFooter(): React.ReactElement {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className="border-t border-[var(--color-brand-border)] px-3 py-3">
      <div className="flex justify-end">
        <button
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--brand-text-muted)] transition-all hover:bg-[var(--brand-background)] hover:text-[var(--brand-text)]"
          title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
