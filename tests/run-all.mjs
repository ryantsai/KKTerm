// Auto-discovering test runner for `npm run check`.
//
// Discovers every `tests/*.test.mjs` file and runs it through the Node test
// runner. A new test file is picked up automatically — there is no hand-edited
// `&&` chain to keep in sync, so tests can no longer be silently left unrun.
//
// QUARANTINE holds source-grep guards whose asserted implementation text has
// drifted from the current source. It is currently empty — every previously
// quarantined guard has been realigned with the live source and is back under
// `npm run check`. Do not add new entries to grow the quarantine — fix the test.
import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);

const QUARANTINE = new Set([]);

const entries = await readdir(here);
// .test.mjs are plain Node tests; .test.ts are behavioral tests against pure
// frontend modules, run through the tsx loader (added below).
const allTests = entries
  .filter((name) => name.endsWith(".test.mjs") || name.endsWith(".test.ts"))
  .sort();
const active = allTests.filter((name) => !QUARANTINE.has(name));
const skipped = allTests.filter((name) => QUARANTINE.has(name));

if (skipped.length > 0) {
  console.log(
    `Quarantined ${skipped.length} stale source-grep guard(s) (pending behavioral replacement):`,
  );
  for (const name of skipped) {
    console.log(`  - ${name}`);
  }
  console.log("");
}

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", ...active.map((name) => join("tests", name))],
  { cwd: repoRoot, stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
