export interface RoomViewportSize {
  w: number;
  h: number;
}

export interface RoomScrollPosition {
  left: number;
  top: number;
}

export interface RoomPanFrame {
  w: number;
  h: number;
  insetX: number;
  insetY: number;
  sceneLeft: number;
  sceneTop: number;
}

const MIN_PAN_INSET = 96;
const MAX_PAN_INSET = 320;
const PAN_INSET_RATIO = 0.25;

function panInset(size: number): number {
  return Math.min(
    MAX_PAN_INSET,
    Math.max(MIN_PAN_INSET, Math.round(size * PAN_INSET_RATIO)),
  );
}

/** Surround a room scene with scrollable camera space even when the scene
 *  itself is sized to exactly fit the visible viewport. */
export function roomPanFrame(
  viewport: RoomViewportSize,
  scene: RoomViewportSize,
  includeMargin = true,
): RoomPanFrame {
  if (!includeMargin) {
    return {
      w: scene.w,
      h: scene.h,
      insetX: 0,
      insetY: 0,
      sceneLeft: 0,
      sceneTop: 0,
    };
  }
  const insetX = panInset(viewport.w);
  const insetY = panInset(viewport.h);
  return {
    w: scene.w + insetX * 2,
    h: scene.h + insetY * 2,
    insetX,
    insetY,
    sceneLeft: insetX,
    sceneTop: insetY,
  };
}

export function roomScrollCenter(
  viewport: RoomViewportSize,
  content: RoomViewportSize,
): { left: number; top: number } {
  return {
    left: Math.max(0, (content.w - viewport.w) / 2),
    top: Math.max(0, (content.h - viewport.h) / 2),
  };
}

/** Move a scroll position with the camera's center while keeping any manual
 *  pan offset from that center. */
export function preserveRoomPan(
  currentScroll: RoomScrollPosition,
  previousCenter: RoomScrollPosition,
  nextCenter: RoomScrollPosition,
): RoomScrollPosition {
  return {
    left: currentScroll.left + nextCenter.left - previousCenter.left,
    top: currentScroll.top + nextCenter.top - previousCenter.top,
  };
}

export function centerRoomViewport(
  ref: { current: HTMLElement | null },
): void {
  const node = ref.current;
  if (!node) return;
  const center = roomScrollCenter(
    { w: node.clientWidth, h: node.clientHeight },
    { w: node.scrollWidth, h: node.scrollHeight },
  );
  node.scrollLeft = center.left;
  node.scrollTop = center.top;
}
