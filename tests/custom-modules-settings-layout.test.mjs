import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("installed Custom Module controls use the shared Settings row layout", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../src/modules/settings/CustomModulesSettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/settings/settings.css", import.meta.url), "utf8"),
  ]);

  assert.equal(
    [...source.matchAll(/className="settings-toggle-row custom-module-toggle-row"/g)].length,
    2,
    "both installed-module switches should opt out of the generic two-column field grid",
  );
  assert.match(source, /className="settings-icon-danger-button"/);
  assert.match(css, /\.custom-module-card-heading\s*\{[^}]*grid-template-columns:/s);
  assert.match(css, /\.custom-module-toggle-row\s*\{[^}]*min-width:\s*0;/s);
  assert.match(css, /@media \(max-width:\s*780px\)[\s\S]*\.custom-module-card-heading/s);
});
