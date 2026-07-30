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
    ...map.graph.nodes.flatMap((node) => [
      node.id,
      node.label,
      node.kind,
      node.x,
      node.y,
      node.width,
      node.height,
      node.shape,
      node.iconAccent,
      node.iconBackgroundColor,
      node.locked,
      ...node.interfaces.flatMap((entry) => [entry.id, entry.name, entry.address]),
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
      ...link.strands.flatMap((strand) => [
        strand.id,
        strand.name,
        strand.fromInterfaceId,
        strand.toInterfaceId,
        strand.speed,
      ]),
      link.nativeVlanId,
      ...link.taggedVlanIds,
      link.status,
    ]),
    ...map.graph.notes.flatMap((note) => [
      note.id,
      note.text,
      note.x,
      note.y,
      note.width,
      note.height,
      note.backgroundAccent,
      note.backgroundColor,
      note.locked,
    ]),
    ...displayTerms,
  ].join("\n"));

  return terms.every((term) => searchable.includes(term));
}
