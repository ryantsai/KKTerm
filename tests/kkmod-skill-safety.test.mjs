import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const validator = fileURLToPath(
  new URL(
    "../.agents/skills/develop-kkmod-modules/scripts/kkmod_tool.py",
    import.meta.url,
  ),
);
const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");

async function createFixture(html) {
  const root = await mkdtemp(join(tmpdir(), "kkmod-html-paths-"));
  await mkdir(join(root, "dist", "assets"), { recursive: true });
  await mkdir(join(root, "licenses"), { recursive: true });
  await writeFile(
    join(root, "kkterm-extension.json"),
    JSON.stringify({
      id: "com.example.path-test",
      name: "Path test",
      version: "1.0.0",
      publisher: "KKTerm tests",
      apiVersion: 2,
      license: { name: "MIT", file: "licenses/LICENSE" },
      modules: [
        {
          id: "path-test",
          title: "Path test",
          entrypoint: "dist/index.html",
          routing: "static",
        },
      ],
    }),
  );
  await writeFile(join(root, "dist", "index.html"), html);
  await writeFile(join(root, "dist", "assets", "app.js"), "");
  await writeFile(join(root, "licenses", "LICENSE"), "MIT");
  return root;
}

function check(root) {
  return spawnSync(python, [validator, "check", root], {
    encoding: "utf8",
    windowsHide: true,
  });
}

test("KKMod validator rejects HTML assets that escape dist", async () => {
  const validRoot = await createFixture('<script src="./assets/app.js"></script>');
  const invalidRoot = await createFixture('<script src="../../assets/app.js"></script>');
  try {
    assert.equal(check(validRoot).status, 0);
    const invalid = check(invalidRoot);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /HTML reference escapes dist/);
  } finally {
    await Promise.all([
      rm(validRoot, { recursive: true, force: true }),
      rm(invalidRoot, { recursive: true, force: true }),
    ]);
  }
});

test("KKMod skill requires host-authoritative locale matching", async () => {
  const skill = await readFile(
    new URL("../.agents/skills/develop-kkmod-modules/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(skill, /KKTerm's UI locale is authoritative/);
  assert.match(skill, /fall back to English only when no translation exists/);
  assert.match(skill, /zh-TW.*zh-CN/);
  assert.match(skill, /contextChanged.*locale updates live/);
});
