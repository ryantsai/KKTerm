export interface KKTermContext {
  apiVersion: 2;
  theme: string;
  locale: string;
}

export interface KKTermDocumentMetadata {
  key: string;
  sha256: string;
  byteSize: number;
  updatedAt: string;
}

export interface KKTermHost {
  readonly apiVersion: 2;
  readonly context: KKTermContext;
  ready(): Promise<boolean>;
  getContext(): Promise<KKTermContext>;
  getCapabilities(): Promise<Record<string, unknown>>;
  openExternal(url: string): Promise<boolean>;
  documents: {
    get(key: string): Promise<unknown | null>;
    set(key: string, value: unknown): Promise<boolean>;
    delete(key: string): Promise<boolean>;
    list(): Promise<KKTermDocumentMetadata[]>;
  };
  on(event: "contextChanged", listener: (context: KKTermContext) => void): () => boolean;
  on(
    event: "visibilityChanged" | "focusChanged" | "suspending" | "closing",
    listener: (detail: unknown) => void,
  ): () => boolean;
}

declare global {
  interface Window {
    KKTerm: KKTermHost;
  }
}

export function getKKTerm(): KKTermHost {
  if (!window.KKTerm || window.KKTerm.apiVersion !== 2) {
    throw new Error("KKTerm host API v2 is unavailable.");
  }
  return window.KKTerm;
}
