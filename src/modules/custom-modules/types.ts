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
  routing: "static" | "spa";
}

export interface CustomModuleFilePermission {
  open: boolean;
  save: boolean;
  extensions: string[];
}

export interface CustomModuleNetworkPermission {
  origins: string[];
  methods: Array<"GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE">;
  allowPrivateNetwork: boolean;
  maxResponseBytes: number;
}

export interface CustomModulePermissions {
  storage: boolean;
  documentStorage: boolean;
  blobStorage: boolean;
  browserStorage: boolean;
  openExternal: boolean;
  clipboard: boolean;
  files?: CustomModuleFilePermission | null;
  networkFetch?: CustomModuleNetworkPermission | null;
  secretReferences: boolean;
  hostUi: boolean;
}

export interface CustomModuleDataUsage {
  storageBytes: number;
  documentBytes: number;
  blobBytes: number;
  browserBytes: number;
  secretCount: number;
  totalBytes: number;
}

export interface CustomModuleManifest {
  id: string;
  name: string;
  version: string;
  publisher: string;
  summary: string;
  apiVersion: 2;
  homepage?: string | null;
  license: CustomModuleLicense;
  permissions: CustomModulePermissions;
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
  apiVersion: 2;
  downloadUrl: string;
  sha256: string;
  signature: string;
  license: string;
  permissions: CustomModulePermissions;
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
