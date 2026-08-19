import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fieldsSource = await readFile(
  new URL("../src/modules/workspace/connections/connection-dialog/SerialConnectionFields.tsx", import.meta.url),
  "utf8",
);
const connectionsCss = await readFile(
  new URL("../src/modules/workspace/connections/connections.css", import.meta.url),
  "utf8",
);

test("Serial speed keeps the requested common baud suggestions", () => {
  assert.match(
    fieldsSource,
    /COMMON_SERIAL_SPEEDS\s*=\s*\[9600,\s*19200,\s*38400,\s*115200\]/,
  );
  assert.match(fieldsSource, /COMMON_SERIAL_SPEEDS\.map\(\(value\)/);
});

test("Serial speed remains an editable positive integer input", () => {
  assert.match(fieldsSource, /name="serialSpeed"[\s\S]*?value=\{speed\}/);
  assert.match(fieldsSource, /name="serialSpeed"[\s\S]*?min="1"[\s\S]*?step="1"/);
  assert.match(fieldsSource, /name="serialSpeed"[\s\S]*?onChange=\{\(event\) => setSpeed/);
  assert.match(connectionsCss, /\.serial-combobox:has|\.serial-combobox\s*\{/);
});
