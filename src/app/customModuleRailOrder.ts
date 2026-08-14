import type { CustomModuleDestination } from "../modules/custom-modules/types";
import { customModuleDestinationKey } from "../modules/custom-modules/useCustomModules";

export function orderCustomModuleDestinations(
  destinations: readonly CustomModuleDestination[],
  storedOrder: readonly string[] | undefined,
) {
  const destinationsByKey = new Map(
    destinations.map((destination) => [
      customModuleDestinationKey(destination),
      destination,
    ]),
  );
  const knownKeys = (storedOrder ?? []).filter(
    (key, index, keys) => destinationsByKey.has(key) && keys.indexOf(key) === index,
  );
  const orderedKeys = [
    ...knownKeys,
    ...Array.from(destinationsByKey.keys()).filter((key) => !knownKeys.includes(key)),
  ];
  return orderedKeys.map((key) => destinationsByKey.get(key)!);
}

export function reorderCustomModuleDestinations(
  destinations: readonly CustomModuleDestination[],
  storedOrder: readonly string[] | undefined,
  draggedKey: string,
  targetKey: string | null,
) {
  const orderedKeys = orderCustomModuleDestinations(destinations, storedOrder).map(
    customModuleDestinationKey,
  );
  const from = orderedKeys.indexOf(draggedKey);
  if (from < 0) return orderedKeys;

  const [moved] = orderedKeys.splice(from, 1);
  const to = targetKey === null ? orderedKeys.length : orderedKeys.indexOf(targetKey);
  orderedKeys.splice(to < 0 ? orderedKeys.length : to, 0, moved);
  return orderedKeys;
}
