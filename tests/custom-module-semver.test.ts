import assert from "node:assert/strict";
import test from "node:test";
import { compareCustomModuleVersions } from "../src/modules/custom-modules/catalog.ts";

test("Custom Module updates only move to newer semantic versions", () => {
  assert.equal(compareCustomModuleVersions("1.1.0", "1.0.9"), 1);
  assert.equal(compareCustomModuleVersions("2.0.0", "2.0.0"), 0);
  assert.equal(compareCustomModuleVersions("2.0.0-beta.2", "2.0.0-beta.1"), 1);
  assert.equal(compareCustomModuleVersions("2.0.0", "2.0.0-rc.1"), 1);
  assert.equal(compareCustomModuleVersions("1.9.9", "2.0.0"), -1);
});
