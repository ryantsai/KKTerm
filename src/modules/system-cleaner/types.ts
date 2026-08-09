export type SystemCleanerOverview = {
  scanRoot: string;
  totalBytes: number;
  largest: Array<{ path: string; bytes: number }>;
  cleanup: Array<{ id: string; path: string; bytes: number }>;
  apps: Array<{ name: string; id: string; version: string }>;
  extensions: Array<{ extension: string; bytes: number; files: number }>;
  fileCount: number;
  folderCount: number;
  elapsedMs: number;
  diskCapacityBytes: number;
  diskFreeBytes: number;
};

export type SystemCleanerScanProgress = {
  files: number;
  folders: number;
  bytes: number;
  currentPath: string;
  elapsedMs: number;
};
