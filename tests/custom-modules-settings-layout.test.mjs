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
  assert.match(source, /className="custom-modules-list custom-modules-installed-list"/);
  assert.match(css, /\.custom-modules-installed-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.match(css, /\.custom-module-card-heading\s*\{[^}]*grid-template-columns:/s);
  assert.doesNotMatch(css, /\.custom-module-controls\s*\{[^}]*border-top:/s);
  assert.match(css, /\.custom-module-controls::before\s*\{[^}]*width:\s*72px;/s);
  assert.match(
    css,
    /\.custom-module-controls\s+\.custom-module-toggle-row\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*0;[^}]*border:\s*0;/s,
  );
  assert.match(css, /@media \(max-width:\s*780px\)[\s\S]*\.custom-module-card-heading/s);
  assert.match(css, /@media \(max-width:\s*1180px\)[\s\S]*\.custom-modules-installed-list/s);
});
