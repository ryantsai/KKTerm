export type SystemCleanerOverview = {
  scanRoot: string;
  totalBytes: number;
  largest: Array<{ path: string; bytes: number }>;
  cleanup: Array<{ id: string; path: string; bytes: number }>;
  apps: Array<{ name: string; id: string; version: string }>;
};
