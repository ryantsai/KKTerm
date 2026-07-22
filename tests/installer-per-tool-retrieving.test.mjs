import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const useToolStatus = await readFile(
  new URL("../src/modules/installer/useToolStatus.ts", import.meta.url),
  "utf8",
);
const state = await readFile(
  new URL("../src/modules/installer/state.ts", import.meta.url),
  "utf8",
);
const page = await readFile(
  new URL("../src/modules/installer/InstallerPage.tsx", import.meta.url),
  "utf8",
);

test("a card's retrieving state is gated on per-tool membership, not the global checking flag", () => {
  // The retrieving placeholder must come from this tool's membership in the
  // in-flight set, otherwise a scoped check (e.g. the post-install refresh of
  // a single tool) flips every card into retrieving.
  assert.match(
    useToolStatus,
    /const checking = useInstallerStore\(\(s\) => s\.checkingToolIds\.has\(recipe\.id\)\)/,
    "useToolStatus must read per-tool checking membership",
  );
  assert.doesNotMatch(
    useToolStatus,
    /useInstallerStore\(\(s\) => s\.checking\)/,
    "useToolStatus must not gate a card on the global checking flag",
  );
});

test("the store scopes the in-flight check set to the tools actually being checked", () => {
  assert.match(
    state,
    /event\.kind === "checkStarted"[\s\S]*checkingToolIds: new Set\(event\.toolIds\)/,
    "checkStarted must record only the tools in the sweep",
  );
  assert.match(
    state,
    /event\.kind === "checkResult"[\s\S]*nextCheckingToolIds\.delete\(event\.toolId\)/,
    "each result must clear only its own tool's retrieving state",
  );
  assert.match(
    state,
    /event\.kind === "checkFinished"[\s\S]*checkingToolIds: new Set\(\)/,
    "checkFinished must clear any remaining in-flight ids",
  );
});

test("the page count derivation also reads per-tool checking membership", () => {
  assert.match(
    page,
    /checking: checkingToolIds\.has\(recipe\.id\)/,
    "statusFor must pass per-tool checking to deriveToolStatus",
  );
});
