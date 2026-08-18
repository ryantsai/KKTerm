import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { NOTE_ASSET_ATTRIBUTE } from "./noteHtml";

const NOTE_IMAGE_MIN_WIDTH = 48;

/** A note image with a drag-to-resize handle. Width is stored on the node as
 *  a plain `width` attribute (already sanitizer-allowlisted), so a resized
 *  image round-trips through save/load like any other `<img width>`. */
export function NoteImageView({ node, updateAttributes }: ReactNodeViewProps) {
  const dragStart = useRef<{ pointerId: number; startWidth: number; startX: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  function handlePointerDown(event: ReactPointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startWidth =
      (typeof node.attrs.width === "number" && node.attrs.width) ||
      imgRef.current?.getBoundingClientRect().width ||
      NOTE_IMAGE_MIN_WIDTH;
    dragStart.current = { pointerId: event.pointerId, startWidth, startX: event.clientX };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLSpanElement>) {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const editorWidth = imgRef.current?.closest(".note-editor-content")?.clientWidth;
    const maxWidth = editorWidth ? Math.max(NOTE_IMAGE_MIN_WIDTH, editorWidth - 40) : Number.POSITIVE_INFINITY;
    const nextWidth = Math.round(
      Math.min(maxWidth, Math.max(NOTE_IMAGE_MIN_WIDTH, start.startWidth + event.clientX - start.startX)),
    );
    updateAttributes({ width: nextWidth });
  }

  function finishDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    if (dragStart.current?.pointerId !== event.pointerId) return;
    dragStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <NodeViewWrapper className="note-image-view" draggable={false}>
      <img
        alt={typeof node.attrs.alt === "string" ? node.attrs.alt : ""}
        draggable={false}
        ref={imgRef}
        src={typeof node.attrs.src === "string" ? node.attrs.src : undefined}
        style={typeof node.attrs.width === "number" ? { width: `${node.attrs.width}px` } : undefined}
        {...{ [NOTE_ASSET_ATTRIBUTE]: node.attrs[NOTE_ASSET_ATTRIBUTE] }}
      />
      <span
        className="note-image-resize-handle"
        draggable={false}
        onPointerCancel={finishDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
      />
    </NodeViewWrapper>
  );
}
