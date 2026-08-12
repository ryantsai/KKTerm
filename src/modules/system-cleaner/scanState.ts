import { create } from "zustand";
import type { SystemCleanerScanProgress } from "./types";

type SystemCleanerScanState = {
  active: boolean;
  progress?: SystemCleanerScanProgress;
  beginScan: () => void;
  updateProgress: (progress: SystemCleanerScanProgress) => void;
  finishScan: () => void;
};

const initialProgress: SystemCleanerScanProgress = {
  phase: "files",
  files: 0,
  folders: 0,
  bytes: 0,
  currentPath: "",
  elapsedMs: 0,
  phaseCompleted: 0,
  phaseTotal: 0,
};

export const useSystemCleanerScanStore = create<SystemCleanerScanState>((set) => ({
  active: false,
  progress: undefined,
  beginScan: () => set({ active: true, progress: initialProgress }),
  updateProgress: (progress) => set({ progress }),
  finishScan: () => set({ active: false, progress: undefined }),
}));
