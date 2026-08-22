const VERSIONED_RELEASE_PATH = /^\/releases\/v\d+\.\d+\.\d+\/([^/]+)$/;

export function parseReleaseObjectPath(pathname: string) {
  if (pathname === "/releases/latest.json" || pathname === "/releases/latest-tauri.json") {
    return pathname.slice(1);
  }
  const match = VERSIONED_RELEASE_PATH.exec(pathname);
  if (!match || !/^[A-Za-z0-9._-]+$/.test(match[1])) return null;
  return pathname.slice(1);
}

export function contentTypeForKey(key: string) {
  if (key.endsWith(".json")) return "application/json; charset=utf-8";
  if (key.endsWith(".sha256") || key.endsWith(".sig")) return "text/plain; charset=utf-8";
  if (key.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
  if (key.endsWith(".zip")) return "application/zip";
  if (key.endsWith(".dmg")) return "application/x-apple-diskimage";
  return "application/octet-stream";
}

export function cacheControlForKey(key: string) {
  return key === "releases/latest.json" || key === "releases/latest-tauri.json"
    ? "public, max-age=300, must-revalidate"
    : "public, max-age=31536000, immutable";
}

export function parseSingleRange(value: string | null, size: number) {
  if (!value?.startsWith("bytes=") || value.includes(",") || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const offset = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(requestedEnd) || offset >= size || requestedEnd < offset) return null;
  const end = Math.min(requestedEnd, size - 1);
  return { offset, length: end - offset + 1 };
}

export function shouldReturnPartialContent(
  rangeHeader: string | null,
  range: { offset?: number; length?: number } | undefined,
) {
  return Boolean(rangeHeader && range && range.offset !== undefined && range.length !== undefined);
}
