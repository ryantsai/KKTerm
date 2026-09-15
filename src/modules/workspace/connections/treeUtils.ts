import type { Connection, ConnectionFolder, ConnectionStatus, ConnectionTree } from "../../../types";

// Display-only. Each connection is shallow-cloned to attach `status`, so the
// returned tree has fresh references on every `activeSessionCounts` change.
// Never feed the result into a workspace component (Terminal/WebView/RDP/VNC/
// SFTP) — `TerminalWorkspace`'s session `useEffect` depends on `pane.connection`
// and reference churn drives an unbounded mount/unmount loop. Look up the raw
// `Connection` by `id` from the un-augmented tree when handing it to a
// workspace; see `AGENTS.md` and `ConnectionWidgetBody.tsx`.
export function withLiveConnectionStatuses(
  tree: ConnectionTree,
  activeSessionCounts: Record<string, number>,
): ConnectionTree {
  return {
    connections: tree.connections.map((connection) => ({
      ...connection,
      status: liveConnectionStatus(connection.id, activeSessionCounts),
    })),
    folders: tree.folders.map((folder) => withLiveFolderStatuses(folder, activeSessionCounts)),
  };
}

function withLiveFolderStatuses(
  folder: ConnectionFolder,
  activeSessionCounts: Record<string, number>,
): ConnectionFolder {
  return {
    ...folder,
    connections: folder.connections.map((connection) => ({
      ...connection,
      status: liveConnectionStatus(connection.id, activeSessionCounts),
    })),
    folders: folder.folders.map((childFolder) =>
      withLiveFolderStatuses(childFolder, activeSessionCounts),
    ),
  };
}

export function filterConnectionTree(tree: ConnectionTree, normalizedQuery: string): ConnectionTree {
  return {
    connections: tree.connections.filter((connection) =>
      connectionMatchesQuery(connection, normalizedQuery),
    ),
    folders: tree.folders
      .map((folder) => filterConnectionFolder(folder, normalizedQuery))
      .filter((folder): folder is ConnectionFolder => Boolean(folder)),
  };
}

// Store builds cannot provide a useful host-local shell. Keep durable local
// Connections untouched so the direct-download build can still use them, but
// remove them from Store-only navigation surfaces.
export function withoutLocalTerminalConnections(tree: ConnectionTree): ConnectionTree {
  return {
    connections: tree.connections.filter((connection) => connection.type !== "local"),
    folders: tree.folders.map(withoutLocalTerminalFolderConnections),
  };
}

function withoutLocalTerminalFolderConnections(folder: ConnectionFolder): ConnectionFolder {
  return {
    ...folder,
    connections: folder.connections.filter((connection) => connection.type !== "local"),
    folders: folder.folders.map(withoutLocalTerminalFolderConnections),
  };
}

function filterConnectionFolder(
  folder: ConnectionFolder,
  normalizedQuery: string,
): ConnectionFolder | null {
  const folderMatches = folder.name.toLowerCase().includes(normalizedQuery);
  const connections = folderMatches
    ? folder.connections
    : folder.connections.filter((connection) => connectionMatchesQuery(connection, normalizedQuery));
  const folders = folder.folders
    .map((childFolder) => filterConnectionFolder(childFolder, normalizedQuery))
    .filter((childFolder): childFolder is ConnectionFolder => Boolean(childFolder));

  if (!folderMatches && connections.length === 0 && folders.length === 0) {
    return null;
  }

  return {
    ...folder,
    connections,
    folders: folderMatches ? folder.folders : folders,
  };
}

// Keeps only connections whose live status is "connected", pruning folders that
// end up empty. Mirrors `filterConnectionTree` so the "Show Connected" filter
// composes with the search filter and the "Hide Folders" flat view.
export function filterConnectedConnections(tree: ConnectionTree): ConnectionTree {
  return {
    connections: tree.connections.filter((connection) => connection.status === "connected"),
    folders: tree.folders
      .map((folder) => filterConnectedFolder(folder))
      .filter((folder): folder is ConnectionFolder => Boolean(folder)),
  };
}

function filterConnectedFolder(folder: ConnectionFolder): ConnectionFolder | null {
  const connections = folder.connections.filter((connection) => connection.status === "connected");
  const folders = folder.folders
    .map((childFolder) => filterConnectedFolder(childFolder))
    .filter((childFolder): childFolder is ConnectionFolder => Boolean(childFolder));

  if (connections.length === 0 && folders.length === 0) {
    return null;
  }

  return { ...folder, connections, folders };
}

function connectionMatchesQuery(connection: Connection, normalizedQuery: string) {
  return [connection.name, connection.host, connection.user, connection.type]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

export function flattenConnections(tree: ConnectionTree): Connection[] {
  return [
    ...tree.connections,
    ...tree.folders.flatMap((folder) => flattenFolderConnections(folder)),
  ];
}

export function visibleFlatConnections(tree: ConnectionTree): Connection[] {
  return flattenConnections(tree);
}

export function findConnectionInTree(
  tree: ConnectionTree,
  connectionId: string,
): { connection: Connection; folderId?: string } | null {
  const rootConnection = tree.connections.find((connection) => connection.id === connectionId);
  if (rootConnection) {
    return { connection: rootConnection };
  }
  return findConnectionInFolders(tree.folders, connectionId);
}

function flattenFolderConnections(folder: ConnectionFolder): Connection[] {
  return [
    ...folder.connections,
    ...folder.folders.flatMap((childFolder) => flattenFolderConnections(childFolder)),
  ];
}

function findConnectionInFolders(
  folders: ConnectionFolder[],
  connectionId: string,
): { connection: Connection; folderId?: string } | null {
  for (const folder of folders) {
    const connection = folder.connections.find((entry) => entry.id === connectionId);
    if (connection) {
      return { connection, folderId: folder.id };
    }
    const childMatch = findConnectionInFolders(folder.folders, connectionId);
    if (childMatch) {
      return childMatch;
    }
  }
  return null;
}

export function flattenFolders(
  folders: ConnectionFolder[],
  level = 0,
): Array<{ folder: ConnectionFolder; level: number }> {
  return folders.flatMap((folder) => [
    { folder, level },
    ...flattenFolders(folder.folders, level + 1),
  ]);
}

export function collectConnectionFolderIds(folders: ConnectionFolder[]): string[] {
  return folders.flatMap((folder) => [folder.id, ...collectConnectionFolderIds(folder.folders)]);
}

export function countConnections(folder: ConnectionFolder): number {
  return (
    folder.connections.length +
    folder.folders.reduce((total, childFolder) => total + countConnections(childFolder), 0)
  );
}

export function countFolders(folders: ConnectionFolder[]): number {
  return folders.reduce(
    (total, folder) => total + 1 + countFolders(folder.folders),
    0,
  );
}

function liveConnectionStatus(
  connectionId: string,
  activeSessionCounts: Record<string, number>,
): ConnectionStatus {
  return activeSessionCounts[connectionId] ? "connected" : "idle";
}
