// Frontend helpers for the IT Ops IPAM destination (docs/ITOPS.md).
//
// The backend owns the authoritative maths — an AI or MCP caller can write a
// prefix without this file ever running. Everything here is preview and
// presentation: live feedback while the operator is still typing a CIDR, and
// the harvest that turns Connections and Site Hosts into claimable addresses.

import type { Connection, IpAddressRecord, IpamPrefixNode, SiteHost } from "../../types";

/** Dotted-quad to a 32-bit host-order number, or null when it is not one. */
export function parseIpv4(text: string): number | null {
  const parts = text.trim().split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // Reject "" , "1e2", "+1", "01"-style input: only plain decimal octets.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function formatIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join(".");
}

export interface CidrPreview {
  cidr: string;
  network: string;
  broadcast: string;
  firstUsable: string;
  lastUsable: string;
  /** Assignable addresses. A /31 and /32 keep all of theirs (RFC 3021). */
  usable: number;
}

/**
 * What a typed CIDR would become once saved, or null while it is unparseable.
 * Host bits are cleared, matching how the backend canonicalizes on write, so
 * typing 10.1.2.3/24 previews the 10.1.2.0/24 that will actually be stored.
 */
export function previewCidr(text: string): CidrPreview | null {
  const [addressText, lengthText, ...rest] = text.trim().split("/");
  if (rest.length > 0 || !lengthText || !/^\d{1,2}$/.test(lengthText)) return null;
  const length = Number(lengthText);
  if (length > 32) return null;
  const address = parseIpv4(addressText ?? "");
  if (address === null) return null;

  // A /0 mask would need a 32-bit shift, which JavaScript wraps to a no-op.
  const mask = length === 0 ? 0 : (0xffffffff << (32 - length)) >>> 0;
  const network = (address & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const size = 2 ** (32 - length);
  const usable = length >= 31 ? size : size - 2;
  return {
    cidr: `${formatIpv4(network)}/${length}`,
    network: formatIpv4(network),
    broadcast: formatIpv4(broadcast),
    firstUsable: formatIpv4(length >= 31 ? network : network + 1),
    lastUsable: formatIpv4(length >= 31 ? broadcast : broadcast - 1),
    usable,
  };
}

/** Utilization band, so the bar picks a themed class instead of a hex colour. */
export function utilizationTone(utilization: number): "free" | "low" | "high" | "full" {
  if (utilization >= 1) return "full";
  if (utilization >= 0.8) return "high";
  if (utilization > 0) return "low";
  return "free";
}

/** One address the operator could document but has not, with where it came from. */
export interface ClaimCandidate {
  address: string;
  /** Suggested DNS name / label, from the Connection or Host it was found on. */
  label: string;
  origin: "connection" | "host";
  connectionId: string | null;
  hostId: string | null;
}

/**
 * Addresses already visible elsewhere in KKTerm but missing from IPAM. This is
 * the "you already told us about these" list — a Connection pointed at a literal
 * IP, or a Host named by one — so a new install has something to import instead
 * of an empty table. Hostnames that are not literal IPv4 are skipped rather than
 * resolved: name resolution is a network call, and this runs while typing.
 */
export function collectClaimCandidates(
  connections: readonly Connection[],
  hosts: readonly SiteHost[],
  existing: readonly IpAddressRecord[],
): ClaimCandidate[] {
  // Bulk claims are created in the default VRF. The same address documented in
  // another VRF must not hide a valid default-VRF candidate.
  const taken = new Set(
    existing.filter((record) => !record.vrf.trim()).map((record) => record.address),
  );
  const seen = new Set<string>();
  const candidates: ClaimCandidate[] = [];

  const offer = (raw: string, candidate: Omit<ClaimCandidate, "address">) => {
    const address = raw.trim();
    if (parseIpv4(address) === null || taken.has(address) || seen.has(address)) return;
    seen.add(address);
    candidates.push({ address, ...candidate });
  };

  for (const connection of connections) {
    offer(connection.host, {
      label: connection.name,
      origin: "connection",
      connectionId: connection.id,
      hostId: null,
    });
  }
  for (const host of hosts) {
    offer(host.hostname, {
      label: host.label.trim() || host.hostname,
      origin: "host",
      connectionId: host.connectionIds[0] ?? null,
      hostId: host.id,
    });
  }

  candidates.sort((left, right) => (parseIpv4(left.address) ?? 0) - (parseIpv4(right.address) ?? 0));
  return candidates;
}

/**
 * Prefix rows matching a search, keeping every ancestor of a hit so the tree
 * stays readable — a bare list of deep matches loses the indentation's meaning.
 */
export function filterPrefixTree(
  prefixes: readonly IpamPrefixNode[],
  query: string,
): IpamPrefixNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...prefixes];

  const byId = new Map(prefixes.map((prefix) => [prefix.id, prefix]));
  const keep = new Set<string>();
  for (const prefix of prefixes) {
    const haystack = `${prefix.cidr} ${prefix.role} ${prefix.description} ${prefix.vrf}`;
    if (!haystack.toLowerCase().includes(needle)) continue;
    keep.add(prefix.id);
    // Walk up so the match keeps its context. `seen` stops a hand-edited
    // database with a parent cycle from spinning here.
    const seen = new Set<string>([prefix.id]);
    let parentId = prefix.parentId ?? null;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      keep.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }
  return prefixes.filter((prefix) => keep.has(prefix.id));
}

/** Address Records that fall inside a prefix, in numeric order. */
export function addressesInPrefix(
  addresses: readonly IpAddressRecord[],
  prefix: IpamPrefixNode,
): IpAddressRecord[] {
  const bounds = previewCidr(prefix.cidr);
  if (!bounds) return [];
  const low = parseIpv4(bounds.network) ?? 0;
  const high = parseIpv4(bounds.broadcast) ?? 0;
  return addresses
    .filter((record) => {
      if (record.vrf !== prefix.vrf) return false;
      const value = parseIpv4(record.address);
      return value !== null && value >= low && value <= high;
    })
    .sort((left, right) => (parseIpv4(left.address) ?? 0) - (parseIpv4(right.address) ?? 0));
}
