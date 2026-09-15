import assert from "node:assert/strict";
import test from "node:test";

import { connectionCreationOptions } from "../src/modules/workspace/connections/connectionCreationOptions.ts";
import {
  flattenConnections,
  withoutLocalTerminalConnections,
} from "../src/modules/workspace/connections/treeUtils.ts";
import type { Connection, ConnectionFolder, ConnectionTree, ConnectionType } from "../src/types.ts";

function connection(id: string, type: ConnectionType): Connection {
  return {
    id,
    name: id,
    host: type === "local" ? "localhost" : `${id}.example.com`,
    user: type === "local" ? "local" : "user",
    type,
    status: "idle",
  };
}

test("Mac App Store creation menus omit Local terminal only", () => {
  assert.equal(connectionCreationOptions(false)[0]?.type, "local");
  assert.ok(!connectionCreationOptions(true).some((option) => option.type === "local"));
  assert.deepEqual(
    connectionCreationOptions(true).map((option) => option.type),
    connectionCreationOptions(false)
      .filter((option) => option.type !== "local")
      .map((option) => option.type),
  );
});

test("Store navigation filtering hides local Connections without mutating saved data", () => {
  const nestedFolder: ConnectionFolder = {
    id: "nested",
    name: "Nested",
    connections: [connection("nested-local", "local"), connection("nested-serial", "serial")],
    folders: [],
  };
  const tree: ConnectionTree = {
    connections: [connection("root-local", "local"), connection("root-ssh", "ssh")],
    folders: [{
      id: "parent",
      name: "Parent",
      connections: [connection("parent-url", "url")],
      folders: [nestedFolder],
    }],
  };

  const filtered = withoutLocalTerminalConnections(tree);

  assert.deepEqual(
    flattenConnections(filtered).map((entry) => entry.id),
    ["root-ssh", "parent-url", "nested-serial"],
  );
  assert.deepEqual(
    flattenConnections(tree).map((entry) => entry.id),
    ["root-local", "root-ssh", "parent-url", "nested-local", "nested-serial"],
    "Filtering must leave the durable source tree untouched.",
  );
});
