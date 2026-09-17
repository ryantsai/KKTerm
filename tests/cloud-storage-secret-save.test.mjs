import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const sidebar = readFileSync("src/modules/workspace/connections/ConnectionSidebar.tsx", "utf8");
const helper = sidebar.slice(
  sidebar.indexOf("  async function saveConnectionPassword("),
  sidebar.indexOf("  async function assignConnectionPasswordCredential("),
);
assert.ok(helper.includes("async function saveConnectionPassword("));
const compiled = ts.transpileModule(helper, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const loadSave = (invokeCommand) => new Function("invokeCommand", `${compiled}\nreturn saveConnectionPassword;`)(invokeCommand);

test("S3 and Azure secrets are stored under the Connection ID without Saved Credentials", async () => {
  for (const provider of ["s3", "azureBlob"]) {
    const calls = [];
    const save = loadSave(async (...args) => { calls.push(args); });
    const connection = { id: "cloud-test", type: "cloudStorage", cloudStorageOptions: { provider }, hasPassword: false };
    const saved = await save(connection, "test-secret");
    assert.deepEqual(calls, [["store_secret", {
      request: { kind: "connectionPassword", ownerId: "cloud-test", secret: "test-secret" },
    }]]);
    assert.equal(saved.hasPassword, true);
    assert.equal(saved.passwordCredentialId, undefined);
    assert.equal(connection.hasPassword, false);
  }
});

test("secret-store failure rejects the save without claiming a stored secret", async () => {
  const save = loadSave(async () => { throw new Error("store locked"); });
  const connection = { id: "cloud-test", type: "cloudStorage", hasPassword: false };
  await assert.rejects(save(connection, "test-secret"), /store locked/);
  assert.equal(connection.hasPassword, false);
});

test("SSH and FTP retain reusable Saved Credential behavior", async () => {
  for (const type of ["ssh", "ftp"]) {
    const calls = [];
    const result = { id: "saved", passwordCredentialId: "credential" };
    const save = loadSave(async (...args) => { calls.push(args); return result; });
    assert.equal(await save({ id: "saved", type }, "test-secret", false), result);
    assert.deepEqual(calls, [["create_connection_password_credential", {
      request: { connectionId: "saved", secret: "test-secret", allowReuse: false },
    }]]);
  }
});

test("all Connection password save paths use the shared type-aware helper", () => {
  assert.equal((sidebar.match(/await saveConnectionPassword\(/g) ?? []).length, 5);
  assert.equal((sidebar.match(/invokeCommand\("create_connection_password_credential"/g) ?? []).length, 1);
});
