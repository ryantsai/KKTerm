import type { Connection } from "../../types";

export interface ConnectionImportEndpoint {
  connectionId: string;
  connectionName: string;
  hostname: string;
  protocol: string;
  port: number;
}

export interface ConnectionImportGroup {
  key: string;
  hostname: string;
  endpoints: ConnectionImportEndpoint[];
}

const DEFAULT_PORTS: Partial<Record<Connection["type"], number>> = {
  ssh: 22,
  telnet: 23,
  rdp: 3389,
  vnc: 5900,
  ftp: 21,
};

export function connectionImportEndpoint(
  connection: Connection,
): ConnectionImportEndpoint | null {
  if (["local", "serial", "localFiles", "fileView"].includes(connection.type)) {
    return null;
  }
  let hostname = connection.host.trim();
  let protocol = connection.type.toUpperCase();
  let port = connection.port ?? DEFAULT_PORTS[connection.type] ?? 0;
  if (connection.type === "url") {
    try {
      const url = new URL(connection.url ?? "");
      hostname = url.hostname;
      protocol = url.protocol.replace(":", "").toUpperCase();
      port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    } catch {
      return null;
    }
  }
  if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return {
    connectionId: connection.id,
    connectionName: connection.name,
    hostname,
    protocol,
    port,
  };
}

export function groupConnectionImports(connections: readonly Connection[]): ConnectionImportGroup[] {
  const groups = new Map<string, ConnectionImportGroup>();
  for (const connection of connections) {
    const endpoint = connectionImportEndpoint(connection);
    if (!endpoint) continue;
    const key = endpoint.hostname.trim().replace(/\.$/, "").toLocaleLowerCase();
    const group = groups.get(key);
    if (group) {
      group.endpoints.push(endpoint);
    } else {
      groups.set(key, { key, hostname: endpoint.hostname, endpoints: [endpoint] });
    }
  }
  return [...groups.values()];
}
