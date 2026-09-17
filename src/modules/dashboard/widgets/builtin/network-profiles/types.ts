export type NetworkIpMode = "automatic" | "manual" | "disabled";

export interface NetworkProfileAddress {
  address: string;
  prefix: number;
}

export interface NetworkFamilySnapshot {
  mode: NetworkIpMode;
  addresses: NetworkProfileAddress[];
  gateway?: string | null;
}

export interface NetworkAdapterSnapshot {
  id: string;
  name: string;
  detail?: string | null;
  serviceId?: string | null;
  connected: boolean;
  ipv4: NetworkFamilySnapshot;
  ipv6: NetworkFamilySnapshot;
  dnsServers: string[];
}

export interface NetworkProfilesSnapshot {
  platform: "windows" | "macos" | "linux" | string;
  capability: "supported" | "readOnlyMacAppStore" | "networkManagerUnavailable" | "unsupported";
  adapters: NetworkAdapterSnapshot[];
}

export interface ApplyNetworkProfileRequest {
  adapterId: string;
  serviceId?: string | null;
  ipv4: NetworkFamilySnapshot;
  ipv6: NetworkFamilySnapshot;
  dnsServers: string[];
}
