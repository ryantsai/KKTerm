import type { Connection, ConnectionFolder, ConnectionTree, StoredCredentialSummary } from "../../../../types";

export type TerminalPasswordChoice = Pick<Connection, "id" | "name" | "host" | "user">;

function terminalConnections(tree: ConnectionTree): Connection[] {
  const visit = (folder: ConnectionFolder): Connection[] => [
    ...folder.connections,
    ...folder.folders.flatMap(visit),
  ];
  return [...tree.connections, ...tree.folders.flatMap(visit)];
}

export function terminalPasswordChoices(
  tree: ConnectionTree,
  storedCredentials: StoredCredentialSummary[],
  currentConnectionId: string,
): TerminalPasswordChoice[] {
  const availableOwners = new Set(
    storedCredentials
      .filter((credential) => credential.kind === "connectionPassword" && credential.exists)
      .map((credential) => credential.ownerId),
  );
  return terminalConnections(tree)
    .filter((connection) =>
      (connection.type === "ssh" || connection.type === "telnet") &&
      availableOwners.has(connection.passwordCredentialId || connection.id),
    )
    .sort((a, b) =>
      Number(b.id === currentConnectionId) - Number(a.id === currentConnectionId)
      || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      || a.host.localeCompare(b.host, undefined, { sensitivity: "base" }),
    )
    .map(({ id, name, host, user }) => ({ id, name, host, user }));
}

export function filterTerminalPasswordChoices(choices: TerminalPasswordChoice[], query: string) {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return choices;
  return choices.filter((choice) =>
    choice.name.toLocaleLowerCase().includes(term)
    || choice.host.toLocaleLowerCase().includes(term),
  );
}
