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

export type SystemCleanerOverview = {
  scanRoot: string;
  totalBytes: number;
  totalAllocatedBytes: number;
  largest: SystemCleanerDiskEntry[];
  cleanup: SystemCleanerRecipeCatalogEntry[];
  recommendations: Array<{
    id: "large-old-files" | "old-downloads";
    bytes: number;
    files: SystemCleanerReviewFile[];
  }>;
  apps: Array<{ name: string; id: string; version: string }>;
  extensions: Array<{ extension: string; bytes: number; allocatedBytes: number; files: number }>;
  fileCount: number;
  folderCount: number;
  elapsedMs: number;
  diskCapacityBytes: number;
  diskFreeBytes: number;
};

export type SystemCleanerSafety = "safe" | "review" | "risky";

export type SystemCleanerRecipeCatalogEntry = {
  id: string;
  version: number;
  title: string;
  description: string;
  safety: SystemCleanerSafety;
  defaultSelected: boolean;
  displayPath: string;
  bytes: number;
  itemCount: number;
  source: string;
  builtIn: boolean;
  warning?: string | null;
  runningProcesses: string[];
};

export type SystemCleanerCleanupPlanItem = {
  recipeId: string;
  path: string;
  bytes: number;
  modifiedUnixMs: number;
  fileId: number;
};

export type SystemCleanerCleanupPlan = {
  token: string;
  createdAt: string;
  totalBytes: number;
  excludedItems: number;
  items: SystemCleanerCleanupPlanItem[];
  recipeVersions: Record<string, number>;
  blockedProcesses: string[];
};

export type SystemCleanerCleanupResult = {
  runId: string;
  freedBytes: number;
  deletedItems: number;
  skipped: Array<{ path: string; reason: string }>;
  cancelled: boolean;
};

export type SystemCleanerHistoryRecord = {
  id: string;
  startedAt: string;
  completedAt: string;
  origin: "manual" | "retry";
  status: "completed" | "partial" | "cancelled" | "failed";
  recipeVersionsJson: string;
  plannedBytes: number;
  freedBytes: number;
  deletedItems: number;
  skippedItems: number;
  detailsJson: string;
};

export type SystemCleanerAppxPackage = {
  name: string;
  packageFullName: string;
  version: string;
  publisher: string;
};

export type SystemCleanerWindowsMaintenanceStatus = {
  recycleBinBytes: number;
  recycleBinItems: number;
  deliveryOptimizationAvailable: boolean;
  componentCleanupAvailable: boolean;
};

export type SystemCleanerReviewFile = {
  name: string;
  path: string;
  bytes: number;
  allocatedBytes: number;
  modifiedUnixMs: number;
};

export type SystemCleanerDirectoryListing = {
  path: string;
  parentPath?: string;
  totalBytes: number;
  totalAllocatedBytes: number;
  entries: SystemCleanerDiskEntry[];
};

export type SystemCleanerScanProgress = {
  phase: "files";
  files: number;
  folders: number;
  bytes: number;
  currentPath: string;
  elapsedMs: number;
  phaseCompleted: number;
  phaseTotal: number;
};
