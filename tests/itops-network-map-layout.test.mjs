import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Network Map designer uses the Server Room spatial control layout", async () => {
  const designer = await read("src/modules/itops/NetworkMapDesigner.tsx");
  const styles = await read("src/modules/itops/itops.css");

  assert.match(designer, /className="nm-toolbar it-drill-toolbar"/);
  assert.match(designer, /className="it-room-view-controls"[\s\S]*className="rm-segmented"/);
  assert.match(designer, /className="it-drill-actions"/);
  assert.match(designer, /className="au-side nm-side kk-surface"/);
  assert.match(designer, /className="nm-picker-grid"/);
  assert.doesNotMatch(designer, /className="nm-palette"|className="nm-palette-btn"/);

  assert.match(styles, /\.nm-picker-grid\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(styles, /\.nm-palette-btn/);
});
