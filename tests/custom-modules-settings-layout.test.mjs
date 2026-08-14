import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("installed and catalog Custom Modules use one compact card layout", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../src/modules/settings/CustomModulesSettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/settings/settings.css", import.meta.url), "utf8"),
  ]);

  assert.equal(
    [...source.matchAll(/className="settings-toggle-row custom-module-toggle-row"/g)].length,
    1,
    "installed Modules should only expose their enabled switch",
  );
  assert.doesNotMatch(source, /settings\.customModulesShowRail/);
  assert.doesNotMatch(source, /className="custom-module-permissions"/);
  assert.match(source, /className="settings-icon-danger-button"/);
  assert.match(source, /className="custom-modules-list custom-modules-installed-list"/);
  assert.match(source, /className="custom-modules-list custom-modules-catalog-list"/);
  assert.match(css, /\.custom-modules-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.match(css, /\.custom-module-card\s*\{[^}]*height:\s*248px;/s);
  assert.match(css, /\.custom-module-card-heading\s*\{[^}]*grid-template-columns:/s);
  assert.match(css, /\.custom-module-card-heading p\s*\{[^}]*-webkit-line-clamp:\s*2;/s);
  assert.match(css, /\.custom-module-card-footer::before\s*\{[^}]*width:\s*100%;/s);
  assert.match(
    css,
    /\.custom-module-card-footer\s+\.custom-module-toggle-row\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*0;[^}]*border:\s*0;/s,
  );
  assert.match(css, /@media \(max-width:\s*780px\)[\s\S]*\.custom-module-card-heading/s);
  assert.match(css, /@media \(max-width:\s*1180px\)[\s\S]*\.custom-modules-list/s);
});
