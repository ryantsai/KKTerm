import { isTauriRuntime } from "./tauri";
import { isMacPlatform } from "./platform";
import { nativeMenuIcons } from "./nativeMenuIcons";
import {
  normalizeNativeContextMenuItems,
  type NativeContextMenuItem,
  type NativeContextMenuPosition,
} from "./nativeContextMenuModel";
import type {
  CheckMenuItem,
  CheckMenuItemOptions,
  IconMenuItem,
  IconMenuItemOptions,
  MenuItem,
  MenuItemOptions,
  PredefinedMenuItem,
  PredefinedMenuItemOptions,
  Submenu,
  SubmenuOptions,
} from "@tauri-apps/api/menu";
import type { MenuIcon } from "@tauri-apps/api/image";

type TauriMenuApi = typeof import("@tauri-apps/api/menu");
type TauriImageFactory = typeof import("@tauri-apps/api/image").Image;
type TauriMenuEntry =
  | Submenu
  | MenuItem
  | PredefinedMenuItem
  | CheckMenuItem
  | IconMenuItem
  | MenuItemOptions
  | SubmenuOptions
  | IconMenuItemOptions
  | PredefinedMenuItemOptions
  | CheckMenuItemOptions;

export type { NativeContextMenuItem, NativeContextMenuPosition };

export async function showNativeContextMenu(
  items: NativeContextMenuItem[],
  position: NativeContextMenuPosition,
) {
  if (!isTauriRuntime()) {
    return false;
  }

  const normalizedItems = normalizeNativeContextMenuItems(items);
  if (normalizedItems.length === 0) {
    return false;
  }

  try {
    const [menuApi, { LogicalPosition }] = await Promise.all([
      import("@tauri-apps/api/menu"),
      import("@tauri-apps/api/dpi"),
    ]);
    const { Image } = await import("@tauri-apps/api/image");
    const menu = await menuApi.Menu.new({
      items: await Promise.all(
        normalizedItems.map((item) => toTauriMenuItem(item, menuApi, Image)),
      ),
    });
    await menu.popup(new LogicalPosition(Math.round(position.x), Math.round(position.y)));
    return true;
  } catch (error) {
    console.error("Failed to show native context menu", error);
    return false;
  }
}

async function toTauriMenuItem(
  item: NativeContextMenuItem,
  menuApi: TauriMenuApi,
  imageFactory: TauriImageFactory,
): Promise<TauriMenuEntry> {
  if (item.kind === "separator") {
    return menuApi.PredefinedMenuItem.new({ item: "Separator" });
  }

  if (item.kind === "submenu") {
    const icon = await optionalMenuIconToImage(item, imageFactory);
    return menuApi.Submenu.new({
      text: item.label,
      icon,
      enabled: !item.disabled,
      items: await Promise.all(
        item.items.map((submenuItem) => toTauriMenuItem(submenuItem, menuApi, imageFactory)),
      ),
    });
  }

  const icon = await optionalMenuIconToImage(item, imageFactory);
  const options = {
    text: item.label,
    enabled: !item.disabled,
    action: item.action,
  };
  return icon
    ? menuApi.IconMenuItem.new({
        ...options,
        icon,
      })
    : menuApi.MenuItem.new(options);
}

const rasterizedIconCache = new Map<string, Promise<MenuIcon>>();

async function optionalMenuIconToImage(
  item: Extract<NativeContextMenuItem, { kind: "item" | "submenu" }>,
  imageFactory: TauriImageFactory,
): Promise<MenuIcon | undefined> {
  const iconSource = item.iconSrc ?? item.iconSvg;
  if (!iconSource) {
    return undefined;
  }

  try {
    return item.iconSrc
      ? await imageSourceMenuIconToImage(iconSource, imageFactory)
      : await svgMenuIconToImage(iconSource, imageFactory);
  } catch (error) {
    console.warn("Failed to rasterize native menu icon", error);
    return undefined;
  }
}

async function imageSourceMenuIconToImage(
  src: string,
  imageFactory: TauriImageFactory,
) {
  const cacheKey = `${MENU_ICON_SIZE}:${src}`;
  const cachedIcon = rasterizedIconCache.get(cacheKey);
  if (cachedIcon) {
    return cachedIcon;
  }

  const icon = rasterizeImageSourceToPngBytes(src, MENU_ICON_SIZE).then((pngBytes) =>
    imageFactory.fromBytes(pngBytes),
  );
  rasterizedIconCache.set(cacheKey, icon);
  return icon;
}

async function svgMenuIconToImage(
  svg: string,
  imageFactory: TauriImageFactory,
) {
  const macosTemplateIcon = macosTemplateIconForSvg(svg);
  if (macosTemplateIcon) {
    return macosTemplateIcon;
  }

  const cacheKey = `${MENU_ICON_SIZE}:${svg}`;
  const cachedIcon = rasterizedIconCache.get(cacheKey);
  if (cachedIcon) {
    return cachedIcon;
  }

  const icon = rasterizeSvgToPngBytes(svg, MENU_ICON_SIZE).then((pngBytes) =>
    imageFactory.fromBytes(pngBytes),
  );
  rasterizedIconCache.set(cacheKey, icon);
  return icon;
}

const MENU_ICON_SIZE = 16;

const macosTemplateNativeIconsBySvg = new Map<string, MenuIcon>([
  [nativeMenuIcons.arrowDown, "GoRight"],
  [nativeMenuIcons.arrowLeft, "GoLeft"],
  [nativeMenuIcons.arrowRight, "GoRight"],
  [nativeMenuIcons.arrowUp, "GoRight"],
  [nativeMenuIcons.camera, "QuickLook"],
  [nativeMenuIcons.clipboardPaste, "MultipleDocuments"],
  [nativeMenuIcons.columns, "ColumnView"],
  [nativeMenuIcons.copy, "MultipleDocuments"],
  [nativeMenuIcons.download, "Path"],
  [nativeMenuIcons.folderOpen, "GoRight"],
  [nativeMenuIcons.folderPlus, "Add"],
  [nativeMenuIcons.gitCompare, "Network"],
  [nativeMenuIcons.info, "QuickLook"],
  [nativeMenuIcons.keyRound, "LockUnlocked"],
  [nativeMenuIcons.layoutDashboard, "IconView"],
  [nativeMenuIcons.lock, "LockLocked"],
  [nativeMenuIcons.panelRight, "ColumnView"],
  [nativeMenuIcons.pencil, "Advanced"],
  [nativeMenuIcons.play, "GoRight"],
  [nativeMenuIcons.pin, "SmartBadge"],
  [nativeMenuIcons.pinOff, "SmartBadge"],
  [nativeMenuIcons.plus, "Add"],
  [nativeMenuIcons.rotateCcw, "Refresh"],
  [nativeMenuIcons.save, "Path"],
  [nativeMenuIcons.saveAs, "Path"],
  [nativeMenuIcons.scanLine, "QuickLook"],
  [nativeMenuIcons.scissors, "MultipleDocuments"],
  [nativeMenuIcons.server, "Network"],
  [nativeMenuIcons.shield, "LockUnlocked"],
  [nativeMenuIcons.settings, "PreferencesGeneral"],
  [nativeMenuIcons.squarePlus, "Add"],
  [nativeMenuIcons.terminal, "GoRight"],
  [nativeMenuIcons.trash, "Remove"],
  [nativeMenuIcons.upload, "Path"],
  [nativeMenuIcons.unlock, "LockUnlocked"],
  [nativeMenuIcons.userRound, "SmartBadge"],
  [nativeMenuIcons.x, "Remove"],
]);

function macosTemplateIconForSvg(svg: string) {
  return isMacPlatform() ? macosTemplateNativeIconsBySvg.get(svg) : undefined;
}

export function svgToDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function rasterizeSvgToPngBytes(svg: string, size: number) {
  return rasterizeImageSourceToPngBytes(svgToDataUrl(svg.replace(/currentColor/g, "#1f2937")), size);
}

async function rasterizeImageSourceToPngBytes(src: string, size: number) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    throw new Error("Native menu icons require a browser runtime");
  }

  const image = new window.Image();
  image.width = size;
  image.height = size;
  image.src = src;
  await decodeImage(image);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context unavailable");
  }

  context.clearRect(0, 0, size, size);
  context.drawImage(image, 0, 0, size, size);
  return canvasToPngBytes(canvas);
}

async function canvasToPngBytes(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error("Failed to encode native menu icon PNG"));
      }
    }, "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

async function decodeImage(image: HTMLImageElement) {
  if (typeof image.decode === "function") {
    await image.decode();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to decode SVG menu icon"));
  });
}
