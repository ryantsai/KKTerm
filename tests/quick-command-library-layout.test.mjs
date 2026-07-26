import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dialogStyles = await readFile(
  new URL("../src/app/ui/dialog/dialogs.css", import.meta.url),
  "utf8",
);

function ruleFor(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return dialogStyles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

test("Quick Command library keeps filters full-width while preset results scroll", () => {
  const bodyRule = ruleFor(".kk-qc-library-sheet .kk-dlg-body");
  const listRule = ruleFor(".kk-qc-lib-list");

  assert.match(
    bodyRule,
    /overflow-y:\s*hidden/,
    "the dialog body must not gain a width-consuming scrollbar when a category has many presets",
  );
  assert.match(
    listRule,
    /min-height:\s*0/,
    "the preset list must be allowed to shrink within the fixed-height dialog",
  );
  assert.match(
    listRule,
    /overflow-y:\s*auto/,
    "overflowing presets must scroll inside the results region",
  );
});
