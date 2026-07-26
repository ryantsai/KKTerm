import type { NetworkMap } from "../../types";

function normalizeSearchText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase();
}

export function matchesNetworkMapSearch(
  map: NetworkMap,
  query: string,
  displayTerms: readonly string[] = [],
): boolean {
  const terms = normalizeSearchText(query).trim().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return true;

  const searchable = normalizeSearchText([
    map.id,
    map.name,
    map.description,
    map.siteId,
    map.sortOrder,
    map.graph.nodes.length,
    map.graph.links.length,
    map.graph.roots.length,
    ...map.graph.roots,
    ...map.graph.nodes.flatMap((node) => [
      node.id,
      node.label,
      node.kind,
      node.x,
      node.y,
      node.address,
      node.status,
      node.hostId,
      node.connectionId,
      node.rackItemId,
      node.note,
    ]),
    ...map.graph.links.flatMap((link) => [
      link.id,
      link.from,
      link.to,
      link.label,
      link.kind,
      link.connectionCount,
      link.speed,
      link.status,
    ]),
    ...displayTerms,
  ].join("\n"));

  return terms.every((term) => searchable.includes(term));
}
