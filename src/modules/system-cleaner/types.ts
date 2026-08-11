export type SystemCleanerDiskEntry = {
  name: string;
  path: string;
  bytes: number;
  allocatedBytes: number;
  isDirectory: boolean;
};

export type SystemCleanerDrive = {
  path: string;
  capacityBytes: number;
  freeBytes: number;
};

export type SystemCleanerScannerStatus = {
  available: boolean;
  toolId: string;
};

export type SystemCleanerOverview = {
  scanRoot: string;
  totalBytes: number;
  totalAllocatedBytes: number;
  largest: SystemCleanerDiskEntry[];
  cleanup: Array<{ id: string; path: string; bytes: number }>;
  apps: Array<{ name: string; id: string; version: string }>;
  extensions: Array<{ extension: string; bytes: number; allocatedBytes: number; files: number }>;
  fileCount: number;
  folderCount: number;
  elapsedMs: number;
  diskCapacityBytes: number;
  diskFreeBytes: number;
};

export type SystemCleanerDirectoryListing = {
  path: string;
  parentPath?: string;
  totalBytes: number;
  totalAllocatedBytes: number;
  entries: SystemCleanerDiskEntry[];
};

export type SystemCleanerScanProgress = {
  phase: "metadata" | "files";
  files: number;
  folders: number;
  bytes: number;
  currentPath: string;
  elapsedMs: number;
  phaseCompleted: number;
  phaseTotal: number;
};
