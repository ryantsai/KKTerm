import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

const files = execFileSync("rg", ["--files", "src", "-g", "*.tsx", "-g", "*.ts"], { encoding: "utf8" })
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);

const eventFieldReadPattern = /\bevent\.(?:currentTarget|target)\.(?:value|checked|files)\b/;

function isFunctionalStateSetterCall(node) {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && /^set[A-Z]/.test(node.expression.text)
    && node.arguments.length > 0
    && ts.isArrowFunction(node.arguments[0]);
}

test("React event fields are captured before functional state updaters", () => {
  const violations = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    function visit(node) {
      if (isFunctionalStateSetterCall(node)) {
        const updaterSource = node.arguments[0].getText(sourceFile);
        if (eventFieldReadPattern.test(updaterSource)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          violations.push(`${file}:${line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.deepEqual(
    violations,
    [],
    "Snapshot event.currentTarget/event.target fields in the onChange handler before using a functional state updater.",
  );
});
