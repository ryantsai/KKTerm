import type {
  VncColorLevel,
  VncPerformancePreset,
  VncPreferredEncoding,
} from "../types";

export type VncPerformanceTuning = {
  preferredEncoding: VncPreferredEncoding;
  colorLevel: VncColorLevel;
  compressionLevel: number;
  jpegQuality: number;
  jpegEnabled: boolean;
};

const VNC_PRESET_TUNING: Record<Exclude<VncPerformancePreset, "custom">, VncPerformanceTuning> = {
  auto: {
    preferredEncoding: "tight",
    colorLevel: "full",
    compressionLevel: 2,
    jpegQuality: 7,
    jpegEnabled: true,
  },
  lan: {
    preferredEncoding: "tight",
    colorLevel: "full",
    compressionLevel: 1,
    jpegQuality: 8,
    jpegEnabled: true,
  },
  balanced: {
    preferredEncoding: "tight",
    colorLevel: "full",
    compressionLevel: 2,
    jpegQuality: 7,
    jpegEnabled: true,
  },
  lowBandwidth: {
    preferredEncoding: "tight",
    colorLevel: "full",
    compressionLevel: 6,
    jpegQuality: 4,
    jpegEnabled: true,
  },
  lossless: {
    preferredEncoding: "zrle",
    colorLevel: "full",
    compressionLevel: 2,
    jpegQuality: 9,
    jpegEnabled: false,
  },
};

export function resolveVncPerformanceTuning(
  preset: VncPerformancePreset,
  custom: VncPerformanceTuning,
): VncPerformanceTuning {
  return preset === "custom" ? custom : VNC_PRESET_TUNING[preset];
}
