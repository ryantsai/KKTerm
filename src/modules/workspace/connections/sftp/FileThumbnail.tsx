import { useEffect, useRef, useState } from "react";
import { invokeCommand } from "../../../../lib/tauri";
import type { FileEntry } from "../../../../types";
import { FileGlyph } from "./finderGlyphs";
import { createThumbnailQueue } from "./thumbnailQueue";

export const fileThumbnails = createThumbnailQueue((path) => invokeCommand("read_local_thumbnail", { path }));
const callbacks = new WeakMap<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | undefined;

export function FileThumbnail({ entry, path, size }: { entry: FileEntry; path?: string; size: number }) {
  if (!path || entry.kind !== "file" || !/\.(png|jpe?g|gif|webp|bmp|tiff?|heic|avif)$/i.test(entry.name)) {
    return <FileGlyph entry={entry} size={size} />;
  }
  return <LocalImageThumbnail entry={entry} path={path} size={size} />;
}

function LocalImageThumbnail({ entry, path, size }: { entry: FileEntry; path: string; size: number }) {
  const element = useRef<HTMLSpanElement>(null);
  const [preview, setPreview] = useState<{ key: string; url: string } | null>(null);
  const key = JSON.stringify([path, entry.sizeBytes, entry.modifiedTimestamp]);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    let cancel: (() => void) | undefined;
    let disposed = false;
    observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting);
    });
    callbacks.set(target, (visible) => {
      cancel?.();
      cancel = undefined;
      if (visible) cancel = fileThumbnails.request(key, path, (url) => {
        if (!disposed) setPreview(url ? { key, url } : null);
      });
      else setPreview(null); // Release decoded images as they leave the viewport.
    });
    observer.observe(target);
    return () => {
      disposed = true;
      cancel?.();
      callbacks.delete(target);
      observer?.unobserve(target);
    };
  }, [key, path, entry]);
  return <span ref={element} className="sftp-file-thumbnail">
    {preview?.key === key
      ? <img src={preview.url} alt="" draggable={false} decoding="async" onError={() => setPreview(null)} />
      : <FileGlyph entry={entry} size={size} />}
  </span>;
}
