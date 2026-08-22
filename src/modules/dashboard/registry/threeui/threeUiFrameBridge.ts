export const THREE_UI_FRAME_CONTEXT_MENU_SOURCE = "kkterm";
export const THREE_UI_FRAME_CONTEXT_MENU_MESSAGE = "kkterm.threeui.contextmenu";

export interface ThreeUiFrameContextMenuMessage {
  source: typeof THREE_UI_FRAME_CONTEXT_MENU_SOURCE;
  type: typeof THREE_UI_FRAME_CONTEXT_MENU_MESSAGE;
  clientX: number;
  clientY: number;
  button: number;
  shiftKey: boolean;
}

const THREE_UI_FRAME_CONTEXT_MENU_BRIDGE = `<script data-kkterm-threeui-context-menu>
(function () {
  document.addEventListener('contextmenu', function (event) {
    event.preventDefault();
    event.stopPropagation();
    window.parent.postMessage({
      source: ${JSON.stringify(THREE_UI_FRAME_CONTEXT_MENU_SOURCE)},
      type: ${JSON.stringify(THREE_UI_FRAME_CONTEXT_MENU_MESSAGE)},
      clientX: event.clientX,
      clientY: event.clientY,
      button: event.button,
      shiftKey: event.shiftKey
    }, '*');
  }, true);
})();
</script>`;

export function isThreeUiFrameContextMenuMessage(value: unknown): value is ThreeUiFrameContextMenuMessage {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<ThreeUiFrameContextMenuMessage>;
  return data.source === THREE_UI_FRAME_CONTEXT_MENU_SOURCE
    && data.type === THREE_UI_FRAME_CONTEXT_MENU_MESSAGE
    && typeof data.clientX === "number"
    && typeof data.clientY === "number"
    && typeof data.button === "number"
    && typeof data.shiftKey === "boolean";
}

export function withThreeUiFrameContextMenuBridge(source: string): string {
  if (source.includes("data-kkterm-threeui-context-menu")) return source;
  const head = source.match(/<head\b[^>]*>/i);
  if (head?.index !== undefined) {
    const insertAt = head.index + head[0].length;
    return `${source.slice(0, insertAt)}${THREE_UI_FRAME_CONTEXT_MENU_BRIDGE}${source.slice(insertAt)}`;
  }
  return `${THREE_UI_FRAME_CONTEXT_MENU_BRIDGE}${source}`;
}
