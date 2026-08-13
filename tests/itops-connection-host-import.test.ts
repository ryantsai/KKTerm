import assert from "node:assert/strict";
import test from "node:test";

import { groupConnectionImports } from "../src/modules/itops/hostConnectionImport";
import type { Connection } from "../src/types";

function connection(input: Partial<Connection> & Pick<Connection, "id" | "name" | "type">): Connection {
  return {
    host: "",
    user: "",
    status: "idle",
    ...input,
  };
}

test("groups Connections by normalized host and preserves protocol ports", () => {
  const groups = groupConnectionImports([
    connection({ id: "ssh", name: "Shell", type: "ssh", host: "Server-01.example.com", port: 2222 }),
    connection({ id: "rdp", name: "Desktop", type: "rdp", host: "server-01.EXAMPLE.com.", port: 3390 }),
    connection({ id: "url", name: "Admin", type: "url", url: "https://server-01.example.com:8443/admin" }),
    connection({ id: "local", name: "Local", type: "local" }),
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].endpoints.map(({ protocol, port }) => [protocol, port]),
    [["SSH", 2222], ["RDP", 3390], ["HTTPS", 8443]],
  );
});
