import { serializeAsJSON } from "@excalidraw/excalidraw";
import type {
  BinaryFiles,
  ExcalidrawInitialDataState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";

import type { KKTermHost } from "./kkterm";

const SCENE_KEY = "scene";
const LIBRARY_KEY = "library";
const ASSET_KEY_PREFIX = "asset:";
const FORMAT_VERSION = 1;

type SceneChange = Parameters<NonNullable<ExcalidrawProps["onChange"]>>;

interface StoredScene {
  formatVersion: typeof FORMAT_VERSION;
  document: ExcalidrawInitialDataState;
  assetIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredScene(value: unknown): StoredScene | null {
  if (
    !isRecord(value) ||
    value.formatVersion !== FORMAT_VERSION ||
    !isRecord(value.document) ||
    !Array.isArray(value.assetIds) ||
    !value.assetIds.every((id) => typeof id === "string")
  ) {
    return null;
  }

  return value as unknown as StoredScene;
}

function assetKey(id: string): string {
  return `${ASSET_KEY_PREFIX}${id}`;
}

export async function loadDrawing(
  host: KKTermHost,
): Promise<ExcalidrawInitialDataState | null> {
  const [sceneValue, libraryValue] = await Promise.all([
    host.documents.get(SCENE_KEY),
    host.documents.get(LIBRARY_KEY),
  ]);
  const stored = parseStoredScene(sceneValue);
  const libraryItems = Array.isArray(libraryValue) ? libraryValue : undefined;
  if (!stored && !libraryItems) {
    return null;
  }

  if (!stored) {
    return { libraryItems } as ExcalidrawInitialDataState;
  }

  const files: BinaryFiles = {};
  const storedFiles = await Promise.all(
    stored.assetIds.map(async (id) => [id, await host.documents.get(assetKey(id))] as const),
  );

  for (const [id, value] of storedFiles) {
    if (isRecord(value) && typeof value.id === "string" && value.id === id) {
      files[id] = value as BinaryFiles[string];
    }
  }

  return {
    ...stored.document,
    files,
    libraryItems,
  };
}

export class DrawingPersistence {
  private timer: number | null = null;
  private pending: SceneChange | null = null;
  private saveChain = Promise.resolve();

  constructor(
    private readonly host: KKTermHost,
    private readonly onError: (error: unknown) => void,
  ) {}

  schedule(...change: SceneChange): void {
    this.pending = change;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
    }
    this.timer = window.setTimeout(() => this.flush(), 750);
  }

  flush(): void {
    this.timer = null;
    const change = this.pending;
    this.pending = null;
    if (!change) {
      return;
    }

    this.saveChain = this.saveChain
      .then(() => this.save(change))
      .catch(this.onError);
  }

  dispose(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
    }
    this.flush();
  }

  saveLibrary(
    libraryItems: Parameters<NonNullable<ExcalidrawProps["onLibraryChange"]>>[0],
  ): Promise<void> {
    this.saveChain = this.saveChain
      .then(() => this.host.documents.set(LIBRARY_KEY, libraryItems))
      .then(() => undefined)
      .catch(this.onError);
    return this.saveChain;
  }

  private async save([elements, appState, files]: SceneChange): Promise<void> {
    const assetIds = Object.keys(files).sort();
    await Promise.all(
      assetIds.map((id) => this.host.documents.set(assetKey(id), files[id])),
    );

    const serialized = serializeAsJSON(elements, appState, {}, "local");
    const document = JSON.parse(serialized) as ExcalidrawInitialDataState;
    const previous = parseStoredScene(await this.host.documents.get(SCENE_KEY));

    await this.host.documents.set(SCENE_KEY, {
      formatVersion: FORMAT_VERSION,
      document,
      assetIds,
    } satisfies StoredScene);

    const retained = new Set(assetIds);
    await Promise.all(
      (previous?.assetIds ?? [])
        .filter((id) => !retained.has(id))
        .map((id) => this.host.documents.delete(assetKey(id))),
    );
  }
}
