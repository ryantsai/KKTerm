import "./asset-path";

import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Excalidraw,
  THEME,
  languages,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";

import { getKKTerm, type KKTermContext, type KKTermHost } from "./kkterm";
import { DrawingPersistence, loadDrawing } from "./persistence";
import "./styles.css";

const MESSAGES = {
  loadFailed: "The saved drawing could not be loaded. A blank canvas was opened.",
  saveFailed: "The drawing could not be saved in KKTerm.",
  linkFailed: "The link could not be opened.",
  linkScheme: "Only HTTP and HTTPS links can open outside KKTerm.",
} as const;

function resolveLanguage(locale: string): string {
  const normalized = locale.replace("_", "-").toLowerCase();
  const exact = languages.find((language) => language.code.toLowerCase() === normalized);
  if (exact) {
    return exact.code;
  }

  const base = normalized.split("-")[0];
  return languages.find((language) => language.code.toLowerCase() === base)?.code ?? "en";
}

function applyDocumentContext(context: KKTermContext): void {
  document.documentElement.lang = context.locale;
  document.documentElement.dataset.theme = context.theme;
}

interface AppProps {
  host: KKTermHost;
  initialContext: KKTermContext;
  initialData: ExcalidrawInitialDataState | null;
  initialError: boolean;
}

function App({ host, initialContext, initialData, initialError }: AppProps) {
  const [context, setContext] = useState(initialContext);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const readyRef = useRef(false);
  const initialErrorRef = useRef(initialError);
  const persistence = useMemo(
    () =>
      new DrawingPersistence(host, (error) => {
        console.error("Failed to persist Excalidraw document", error);
        apiRef.current?.setToast({ message: MESSAGES.saveFailed });
      }),
    [host],
  );

  useEffect(() => {
    applyDocumentContext(context);
  }, [context]);

  useEffect(() => {
    const unsubscribe = host.on("contextChanged", setContext);
    return () => {
      unsubscribe();
      persistence.dispose();
    };
  }, [host, persistence]);

  const setApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;
      if (initialErrorRef.current) {
        initialErrorRef.current = false;
        api.setToast({ message: MESSAGES.loadFailed });
      }
      if (!readyRef.current) {
        readyRef.current = true;
        void host.ready().catch((error) => {
          readyRef.current = false;
          console.error("Failed to signal Excalidraw readiness", error);
        });
      }
    },
    [host],
  );

  const openLink = useCallback<NonNullable<ExcalidrawProps["onLinkOpen"]>>(
    (element, event) => {
      const link = element.link;
      if (!link || link.startsWith("#")) {
        return;
      }

      event.preventDefault();
      let url: URL;
      try {
        url = new URL(link);
      } catch {
        apiRef.current?.setToast({ message: MESSAGES.linkScheme });
        return;
      }

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        apiRef.current?.setToast({ message: MESSAGES.linkScheme });
        return;
      }

      void host.openExternal(url.href).catch((error) => {
        console.error("Failed to open Excalidraw link", error);
        apiRef.current?.setToast({ message: MESSAGES.linkFailed });
      });
    },
    [host],
  );

  return (
    <main className="module-shell">
      <Excalidraw
        aiEnabled={false}
        autoFocus
        excalidrawAPI={setApi}
        initialData={initialData}
        isCollaborating={false}
        langCode={resolveLanguage(context.locale)}
        name="KKTerm Excalidraw"
        onChange={(...change) => persistence.schedule(...change)}
        onLinkOpen={openLink}
        renderEmbeddable={() => null}
        theme={context.theme.toLowerCase().includes("dark") ? THEME.DARK : THEME.LIGHT}
        validateEmbeddable={false}
      />
    </main>
  );
}

async function bootstrap(): Promise<void> {
  const host = getKKTerm();
  const context = await host.getContext();
  applyDocumentContext(context);

  let initialData: ExcalidrawInitialDataState | null = null;
  let initialError = false;
  try {
    initialData = await loadDrawing(host);
  } catch (error) {
    initialError = true;
    console.error("Failed to load Excalidraw document", error);
  }

  const root = document.getElementById("root");
  if (!root) {
    throw new Error("Excalidraw root element is missing.");
  }

  createRoot(root).render(
    <StrictMode>
      <App
        host={host}
        initialContext={context}
        initialData={initialData}
        initialError={initialError}
      />
    </StrictMode>,
  );
}

void bootstrap().catch((error) => {
  console.error("Failed to start Excalidraw", error);
  const root = document.getElementById("root");
  if (root) {
    const title = document.createElement("strong");
    title.textContent = "Excalidraw could not start.";
    const detail = document.createElement("span");
    detail.textContent = error instanceof Error ? error.message : String(error);
    root.className = "fatal-error";
    root.replaceChildren(title, detail);
  }
  void getKKTerm().ready().catch((readyError) => {
    console.error("Failed to reveal the Excalidraw startup error", readyError);
  });
});
