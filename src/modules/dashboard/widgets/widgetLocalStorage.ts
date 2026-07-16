import { useEffect, useState } from "react";
import { readDurableUiState, writeDurableUiState } from "../../../lib/durableUiState";

export function readWidgetConfig<T>(
  storageKey: string,
  fallback: T,
  normalize: (value: unknown) => T,
) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? normalize(JSON.parse(raw)) : fallback;
  } catch {
    return fallback;
  }
}

export function useWidgetConfig<T>(
  storageKey: string,
  fallback: T,
  normalize: (value: unknown) => T,
) {
  const [config, setConfig] = useState(() => readWidgetConfig(storageKey, fallback, normalize));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(config));
    } catch {
      // Widget customization should keep working even if localStorage is unavailable.
    }
  }, [config, storageKey]);

  return [config, setConfig] as const;
}

// Same synchronous shape as `useWidgetConfig`, but the value is durable: SQLite
// is the source of truth (backed up, portable, reset-cleared) and the
// synchronous cache mirrors it. Use for widget bodies that hold real
// user-authored content — e.g. Notes — rather than throwaway tool input.
export function useDurableWidgetConfig<T>(
  storageKey: string,
  fallback: T,
  normalize: (value: unknown) => T,
) {
  const [config, setConfig] = useState(() => {
    const raw = readDurableUiState(storageKey);
    if (raw === null) {
      return fallback;
    }
    try {
      return normalize(JSON.parse(raw));
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    writeDurableUiState(storageKey, JSON.stringify(config));
  }, [config, storageKey]);

  return [config, setConfig] as const;
}
