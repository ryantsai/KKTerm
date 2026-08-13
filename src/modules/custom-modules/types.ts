export interface CustomModuleLicense {
  name: string;
  file: string;
  noticesFile?: string | null;
}

export interface CustomModuleContribution {
  id: string;
  title: string;
  icon?: string | null;
  entrypoint: string;
  railVisible: boolean;
}

export interface CustomModuleManifest {
  id: string;
  name: string;
  version: string;
  publisher: string;
  summary: string;
  apiVersion: number;
  homepage?: string | null;
  license: CustomModuleLicense;
  permissions: string[];
  modules: CustomModuleContribution[];
}

export interface InstalledCustomModule extends CustomModuleManifest {
  source: "local" | "catalog";
  trust: "local" | "firstParty";
  enabled: boolean;
  railVisible: boolean;
  sha256: string;
  previousVersion?: string | null;
  health: "ready" | "missing";
  iconDataUrls?: Record<string, string>;
}

export interface CustomModuleCatalogEntry {
  id: string;
  name: string;
  version: string;
  publisher: string;
  summary: string;
  apiVersion: number;
  downloadUrl: string;
  sha256: string;
  signature: string;
  license: string;
  permissions: string[];
  downloadSize: number;
}

export interface CustomModulePackageReview {
  manifest: CustomModuleManifest;
  sha256: string;
  archiveBytes: number;
  expandedBytes: number;
  fileCount: number;
  signed: boolean;
}

export interface CustomModuleDestination {
  moduleId: string;
  contributionId: string;
  title: string;
  icon?: string | null;
  iconDataUrl?: string | null;
}

export interface StartCustomModuleRequest extends CustomModuleDestination {
  x: number;
  y: number;
  width: number;
  height: number;
  theme: string;
  locale: string;
}

export interface CustomModuleSessionStarted {
  sessionId: string;
}
