import type { StoredScreenshot } from "../../lib/tauri";

export type ScreenshotGroupBy =
  | "none"
  | "name"
  | "date"
  | "type"
  | "size"
  | "dateCreated"
  | "dateModified"
  | "dateTaken"
  | "dimensions";

export type ScreenshotGroup = {
  key: string;
  label: string;
  screenshots: StoredScreenshot[];
};

export function screenshotFileType(screenshot: StoredScreenshot) {
  const extension = screenshot.fileName.split(".").pop()?.toUpperCase();
  return extension === "JPG" || extension === "JPEG" ? "JPEG" : extension || "—";
}

function dateLabel(value: number | null) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function sizeGroup(bytes: number) {
  if (bytes < 1024 * 1024) {
    return { key: "0", label: "< 1 MB" };
  }
  if (bytes < 5 * 1024 * 1024) {
    return { key: "1", label: "1–5 MB" };
  }
  if (bytes < 20 * 1024 * 1024) {
    return { key: "2", label: "5–20 MB" };
  }
  return { key: "3", label: "≥ 20 MB" };
}

function groupIdentity(screenshot: StoredScreenshot, groupBy: ScreenshotGroupBy) {
  switch (groupBy) {
    case "name": {
      const first = Array.from(screenshot.fileName.trim())[0]?.toLocaleUpperCase() ?? "#";
      const label = /[\p{L}\p{N}]/u.test(first) ? first : "#";
      return { key: label, label };
    }
    case "date": {
      const label = dateLabel(screenshot.capturedAt);
      return { key: label, label };
    }
    case "type": {
      const label = screenshotFileType(screenshot);
      return { key: label, label };
    }
    case "size":
      return sizeGroup(screenshot.fileSizeBytes);
    case "dateCreated": {
      const label = dateLabel(screenshot.createdAt);
      return { key: label, label };
    }
    case "dateModified": {
      const label = dateLabel(screenshot.modifiedAt);
      return { key: label, label };
    }
    case "dateTaken": {
      const label = dateLabel(screenshot.takenAt ?? screenshot.capturedAt);
      return { key: label, label };
    }
    case "dimensions": {
      const label = screenshot.width > 0 && screenshot.height > 0
        ? `${screenshot.width} × ${screenshot.height}`
        : "—";
      return { key: label, label };
    }
    default:
      return { key: "all", label: "" };
  }
}

export function groupScreenshots(
  screenshots: StoredScreenshot[],
  groupBy: ScreenshotGroupBy,
): ScreenshotGroup[] {
  if (groupBy === "none") {
    return [{ key: "all", label: "", screenshots }];
  }
  const groups = new Map<string, ScreenshotGroup>();
  for (const screenshot of screenshots) {
    const identity = groupIdentity(screenshot, groupBy);
    const existing = groups.get(identity.key);
    if (existing) {
      existing.screenshots.push(screenshot);
    } else {
      groups.set(identity.key, { ...identity, screenshots: [screenshot] });
    }
  }
  return Array.from(groups.values());
}
