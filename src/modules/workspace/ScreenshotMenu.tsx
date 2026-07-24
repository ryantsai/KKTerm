import { Camera } from "../../lib/reicon";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { menuButtonAria } from "../../lib/aria";
import { nativeMenuIcons } from "../../lib/nativeMenuIcons";
import { showNativeContextMenu } from "../../lib/nativeContextMenu";
import {
  invokeCommand,
  isTauriRuntime,
  type CaptureScreenshotRequest,
  type ScreenshotCaptureResult,
  type StoredScreenshot,
} from "../../lib/tauri";
import { finishScreenshotCapture } from "../screenshots/captureBridge";
import { useWorkspaceStore } from "../../store";

type ScreenshotRect = CaptureScreenshotRequest;

type ScreenshotRegionState = {
  bounds: DOMRect;
  pointerId?: number;
  start?: { x: number; y: number };
  current?: { x: number; y: number };
};

export function ScreenshotMenu({
  buttonLabel,
  buttonClassName = "icon-button",
  dataTutorialId = "workspace.screenshotMenu",
  targetRef,
  targetLabel: _targetLabel,
  onPreCapture,
  onCapture,
  onCaptureEntirePanel,
  entirePanelLabel,
}: {
  buttonLabel?: string;
  buttonClassName?: string;
  dataTutorialId?: string;
  targetRef: RefObject<HTMLElement | null>;
  targetLabel?: string;
  onPreCapture?: () => void;
  onCapture?: (
    rect: ScreenshotRect,
    kind: StoredScreenshot["kind"],
  ) => Promise<ScreenshotCaptureResult>;
  onCaptureEntirePanel?: () => Promise<ScreenshotCaptureResult>;
  entirePanelLabel?: string;
}) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [menuOpen, setMenuOpen] = useState(false);
  const [regionState, setRegionState] = useState<ScreenshotRegionState | null>(null);
  const [copiedStatus, setCopiedStatus] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const regionTargetRef = useRef<HTMLDivElement | null>(null);
  const regionSelectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  async function runCapture(capture: () => Promise<ScreenshotCaptureResult>) {
    if (!isTauriRuntime()) {
      showStatusBarNotice(t("workspace.screenshotsRequireRuntime"), { tone: "warning" });
      return;
    }

    try {
      await waitForScreenshotSurface();
      const result = await capture();
      finishScreenshotCapture(result, t);
      setCopiedStatus(t("workspace.takeScreenshot"));
      window.setTimeout(() => setCopiedStatus(""), 1600);
    } catch (error) {
      showStatusBarNotice(
        t("workspace.screenshotCaptureError", {
          message: error instanceof Error ? error.message : String(error),
        }),
        { tone: "error" },
      );
    }
  }

  async function captureRect(
    rect: ScreenshotRect,
    kind: StoredScreenshot["kind"],
  ) {
    await runCapture(() => onCapture
      ? onCapture(rect, kind)
      : invokeCommand("capture_screenshot_to_library", { request: rect, kind }));
  }

  function targetBounds() {
    const target = targetRef.current;
    if (!target) {
      return null;
    }
    const bounds = target.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return null;
    }
    return bounds;
  }

  function handleEntirePanel() {
    setMenuOpen(false);
    if (onCaptureEntirePanel) {
      void runCapture(onCaptureEntirePanel);
      return;
    }
    const bounds = targetBounds();
    if (!bounds) {
      return;
    }
    void captureRect(rectFromBounds(bounds), "window");
  }

  function handleRegion() {
    setMenuOpen(false);
    const bounds = targetBounds();
    if (!bounds) {
      return;
    }
    setRegionState({ bounds });
  }

  async function handleButtonClick(event: ReactMouseEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const opened = await showNativeContextMenu(
      [
        {
          kind: "item",
          label: t("workspace.copyRegion"),
          iconSvg: nativeMenuIcons.scanLine,
          action: handleRegion,
        },
        {
          kind: "item",
          label: entirePanelLabel ?? t("workspace.copyEntirePanel"),
          iconSvg: nativeMenuIcons.camera,
          action: handleEntirePanel,
        },
      ],
      {
        x: bounds.left,
        y: bounds.bottom,
      },
    );
    if (opened || isTauriRuntime()) {
      setMenuOpen(false);
      return;
    }
    setMenuOpen((open) => !open);
  }

  function handleRegionPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!regionState || !pointInBounds(event.clientX, event.clientY, regionState.bounds)) {
      return;
    }
    const point = clampPointToBounds(event.clientX, event.clientY, regionState.bounds);
    event.currentTarget.setPointerCapture(event.pointerId);
    setRegionState({
      ...regionState,
      pointerId: event.pointerId,
      start: point,
      current: point,
    });
  }

  function handleRegionPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!regionState?.start || regionState.pointerId !== event.pointerId) {
      return;
    }
    setRegionState({
      ...regionState,
      current: clampPointToBounds(event.clientX, event.clientY, regionState.bounds),
    });
  }

  function handleRegionPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!regionState?.start || regionState.pointerId !== event.pointerId) {
      return;
    }
    const current = clampPointToBounds(event.clientX, event.clientY, regionState.bounds);
    const rect = rectFromPoints(regionState.start, current);
    setRegionState(null);

    if (rect.width < 4 || rect.height < 4) {
      return;
    }
    void captureRect(rect, "region");
  }

  function handleRegionKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setRegionState(null);
    }
  }

  const selectionRect =
    regionState?.start && regionState.current
      ? rectFromPoints(regionState.start, regionState.current)
      : null;

  useLayoutEffect(() => {
    const node = regionTargetRef.current;
    if (!node || !regionState) {
      return;
    }

    node.style.height = `${regionState.bounds.height}px`;
    node.style.left = `${regionState.bounds.left}px`;
    node.style.top = `${regionState.bounds.top}px`;
    node.style.width = `${regionState.bounds.width}px`;
    // Depend on the individual bounds fields, not the whole object, to avoid redundant DOM writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    regionState?.bounds.height,
    regionState?.bounds.left,
    regionState?.bounds.top,
    regionState?.bounds.width,
  ]);

  useLayoutEffect(() => {
    const node = regionSelectionRef.current;
    if (!node || !selectionRect) {
      return;
    }

    node.style.height = `${selectionRect.height}px`;
    node.style.left = `${selectionRect.x}px`;
    node.style.top = `${selectionRect.y}px`;
    node.style.width = `${selectionRect.width}px`;
    // selectionRect is recomputed each render; depend on its fields, not the object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionRect?.height, selectionRect?.width, selectionRect?.x, selectionRect?.y]);

  return (
    <>
      <div className="terminal-menu-wrapper screenshot-menu-wrapper" ref={menuRef}>
        <button
          aria-label={t("workspace.takeScreenshot")}
          {...menuButtonAria(menuOpen)}
          className={buttonClassName}
          data-tutorial-id={dataTutorialId}
          onClick={(event) => void handleButtonClick(event)}
          onMouseEnter={() => onPreCapture?.()}
          title={copiedStatus || t("workspace.takeScreenshot")}
          type="button"
        >
          <Camera size={13} />
          {buttonLabel ? <span>{buttonLabel}</span> : null}
        </button>
        {menuOpen ? (
          <div className="terminal-menu screenshot-menu" role="menu">
            <button
              className="terminal-menu-item"
              onClick={handleRegion}
              role="menuitem"
              type="button"
            >
              {t("workspace.copyRegion")}
            </button>
            <button
              className="terminal-menu-item"
              onClick={handleEntirePanel}
              role="menuitem"
              type="button"
            >
              {entirePanelLabel ?? t("workspace.copyEntirePanel")}
            </button>
          </div>
        ) : null}
      </div>
      {regionState ? (
        <div
          aria-label={t("workspace.selectRegion")}
          className="screenshot-region-overlay"
          onKeyDown={handleRegionKeyDown}
          onPointerDown={handleRegionPointerDown}
          onPointerMove={handleRegionPointerMove}
          onPointerUp={handleRegionPointerUp}
          role="application"
          tabIndex={-1}
        >
          <div className="screenshot-region-target" ref={regionTargetRef} />
          {selectionRect ? (
            <div className="screenshot-region-selection" ref={regionSelectionRef} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function rectFromBounds(bounds: DOMRect): ScreenshotRect {
  return {
    x: Math.max(0, Math.round(bounds.left)),
    y: Math.max(0, Math.round(bounds.top)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

function rectFromPoints(
  start: { x: number; y: number },
  current: { x: number; y: number },
): ScreenshotRect {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.max(1, Math.round(Math.abs(current.x - start.x))),
    height: Math.max(1, Math.round(Math.abs(current.y - start.y))),
  };
}

function pointInBounds(x: number, y: number, bounds: DOMRect) {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function clampPointToBounds(x: number, y: number, bounds: DOMRect) {
  return {
    x: Math.min(Math.max(x, bounds.left), bounds.right),
    y: Math.min(Math.max(y, bounds.top), bounds.bottom),
  };
}

async function waitForScreenshotSurface() {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => window.setTimeout(resolve, 90));
}
