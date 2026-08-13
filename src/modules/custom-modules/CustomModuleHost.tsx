import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import { documentHasCustomModuleBlockingOverlay } from "../workspace/nativeOverlay";
import type { CustomModuleDestination } from "./types";
import { CustomModuleIcon } from "./CustomModuleIcon";
import "./customModules.css";

export function CustomModuleHost({
  active,
  blockingOverlayOpen,
  destination,
}: {
  active: boolean;
  blockingOverlayOpen: boolean;
  destination: CustomModuleDestination | null;
}) {
  const { i18n, t } = useTranslation();
  const appearance = useWorkspaceStore((state) => state.appearanceSettings);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);
  const contextRef = useRef({
    theme: appearance.colorScheme,
    locale: i18n.resolvedLanguage || i18n.language || "en",
  });
  contextRef.current = {
    theme: appearance.colorScheme,
    locale: i18n.resolvedLanguage || i18n.language || "en",
  };
  const blockingOverlayOpenRef = useRef(blockingOverlayOpen);
  blockingOverlayOpenRef.current = blockingOverlayOpen;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const pushBounds = useCallback(() => {
    if (!active || !sessionIdRef.current || !surfaceRef.current) return;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const bounds = surfaceRef.current?.getBoundingClientRect();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0 || !sessionIdRef.current) return;
      void invokeCommand("update_custom_module_bounds", {
        request: {
          sessionId: sessionIdRef.current,
          x: bounds.left,
          y: bounds.top,
          width: bounds.width,
          height: bounds.height,
        },
      }).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
    });
  }, [active]);

  useEffect(() => {
    if (!isTauriRuntime() || !active || !destination || !surfaceRef.current) return;
    let disposed = false;
    setError(null);
    setReady(false);
    const bounds = surfaceRef.current.getBoundingClientRect();
    const context = contextRef.current;
    void invokeCommand("start_custom_module", {
      request: {
        ...destination,
        x: bounds.left,
        y: bounds.top,
        width: Math.max(1, bounds.width),
        height: Math.max(1, bounds.height),
        theme: context.theme,
        locale: context.locale,
      },
    })
      .then(({ sessionId }) => {
        if (disposed) {
          void invokeCommand("close_custom_module", { sessionId });
          return;
        }
        sessionIdRef.current = sessionId;
        pushBounds();
        const blocked =
          blockingOverlayOpenRef.current ||
          documentHasCustomModuleBlockingOverlay(surfaceRef.current);
        void invokeCommand("set_custom_module_visibility", {
          sessionId,
          visible: !blocked,
        }).catch(() => undefined);
      })
      .catch((caught) => {
        if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      disposed = true;
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sessionId) void invokeCommand("close_custom_module", { sessionId });
    };
  }, [active, destination, pushBounds]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const resizeObserver = new ResizeObserver(pushBounds);
    if (surfaceRef.current) resizeObserver.observe(surfaceRef.current);
    window.addEventListener("resize", pushBounds);
    window.addEventListener("scroll", pushBounds, true);
    const moveUnlisten = listen("tauri://move", pushBounds).catch(() => null);
    const resizeUnlisten = listen("tauri://resize", pushBounds).catch(() => null);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", pushBounds);
      window.removeEventListener("scroll", pushBounds, true);
      void moveUnlisten.then((dispose) => dispose?.());
      void resizeUnlisten.then((dispose) => dispose?.());
    };
  }, [pushBounds]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const updateVisibility = () => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      const blocked =
        blockingOverlayOpen || documentHasCustomModuleBlockingOverlay(surfaceRef.current);
      void invokeCommand("set_custom_module_visibility", {
        sessionId,
        visible: active && !blocked,
      }).catch(() => undefined);
    };
    updateVisibility();
    const observer = new MutationObserver(updateVisibility);
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    window.addEventListener("resize", updateVisibility);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateVisibility);
    };
  }, [active, blockingOverlayOpen, destination]);

  useEffect(() => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    void invokeCommand("update_custom_module_context", {
      request: {
        sessionId,
        theme: appearance.colorScheme,
        locale: i18n.resolvedLanguage || i18n.language || "en",
      },
    }).catch(() => undefined);
  }, [appearance.colorScheme, i18n.language, i18n.resolvedLanguage]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen<{ sessionId: string }>("custom-module-ready", (event) => {
      if (event.payload.sessionId === sessionIdRef.current) setReady(true);
    });
    return () => void unlisten.then((dispose) => dispose());
  }, []);

  useEffect(() => {
    if (!error) return;
    const sessionId = sessionIdRef.current;
    if (sessionId) {
      void invokeCommand("set_custom_module_visibility", {
        sessionId,
        visible: false,
      }).catch(() => undefined);
    }
    showStatusBarNotice(error, { tone: "error" });
  }, [error, showStatusBarNotice]);

  useEffect(() => {
    if (!isTauriRuntime() || !active || ready || error) return;
    const timeout = window.setTimeout(() => {
      setError(t("settings.customModulesReadyTimeout"));
    }, 15_000);
    return () => window.clearTimeout(timeout);
  }, [active, error, ready, t]);

  if (!destination) return null;
  return (
    <main className="custom-module-page" data-active={active}>
      <header className="custom-module-page-header">
        <span className="custom-module-page-icon">
          <CustomModuleIcon iconDataUrl={destination.iconDataUrl} size={17} />
        </span>
        <h1>{destination.title}</h1>
        {!ready && !error ? <span>{t("common.loading")}</span> : null}
      </header>
      <div className="custom-module-surface" ref={surfaceRef}>
        {!isTauriRuntime() ? (
          <div className="custom-module-fallback">{t("settings.customModulesRuntimeRequired")}</div>
        ) : null}
        {error ? <div className="custom-module-fallback error">{error}</div> : null}
      </div>
    </main>
  );
}
