import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("every distinct Install Helper artwork is available to Connection icons", async () => {
  const installerSource = await readFile(
    new URL("../src/modules/installer/icons.ts", import.meta.url),
    "utf8",
  );
  const connectionSource = await readFile(
    new URL("../src/lib/brandIconUrls.ts", import.meta.url),
    "utf8",
  );
  const assetPattern = /assets\/installer-icons\/([^"?]+)\?url/g;
  const installerAssets = [...installerSource.matchAll(assetPattern)].map((match) => match[1]);
  const connectionAssets = [...connectionSource.matchAll(assetPattern)].map((match) => match[1]);
  const connectionImports = [...connectionSource.matchAll(
    /import\s+(\w+)\s+from\s+"\.\.\/assets\/installer-icons\/([^"?]+)\?url";/g,
  )];
  const connectionMap = connectionSource.match(
    /const brandIconUrlById:[^{]+\{([\s\S]*?)\n\};/,
  )?.[1] ?? "";

  assert.equal(
    new Set(installerAssets).size,
    installerAssets.length,
    "Install Helper should import each distinct artwork once",
  );
  for (const asset of new Set(installerAssets)) {
    assert.equal(
      connectionAssets.filter((candidate) => candidate === asset).length,
      1,
      `${asset} should resolve once for Connection icons`,
    );
    const importedName = connectionImports.find((match) => match[2] === asset)?.[1];
    assert.ok(importedName, `${asset} should have a Connection icon import`);
    assert.match(
      connectionMap,
      new RegExp(`\\b${importedName}\\b`),
      `${asset} should be present in the Connection icon URL map`,
    );
  }
});

for (const { id, asset } of [
  { id: "claude-code-cli", asset: "claude-code.svg" },
  { id: "codex-cli", asset: "codex.svg" },
  { id: "codex-desktop", asset: "codex.svg" },
  { id: "cursor-cli", asset: "cursor.svg" },
  { id: "kimi-code-cli", asset: "kimi.svg" },
  { id: "grok-build", asset: "grok.svg" },
  { id: "ffmpeg", asset: "ffmpeg.svg" },
  { id: "oh-my-posh", asset: "oh-my-posh.svg" },
  { id: "bentopdf", asset: "bentopdf.svg" },
  { id: "bun", asset: "bun.svg" },
  { id: "herdr", asset: "herdr.svg" },
  { id: "t3-code", asset: "t3-code.svg" },
  { id: "openflowkit", asset: "openflowkit.svg" },
  { id: "drawio", asset: "drawio.svg" },
  { id: "krita", asset: "krita.svg" },
  { id: "inkscape", asset: "inkscape.svg" },
  { id: "scrcpy", asset: "scrcpy.svg" },
]) {
  test(`${id} uses a bundled Install Helper icon`, async () => {
    const iconsSource = await readFile(
      new URL("../src/modules/installer/icons.ts", import.meta.url),
      "utf8",
    );
    const readmeSource = await readFile(
      new URL("../src/assets/installer-icons/README.md", import.meta.url),
      "utf8",
    );

    await access(new URL(`../src/assets/installer-icons/${asset}`, import.meta.url));
    assert.match(
      iconsSource,
      new RegExp(`import\\s+\\w+\\s+from\\s+"\\.\\./\\.\\./assets/installer-icons/${asset}\\?url"`),
      `${asset} should be fingerprinted through Vite`,
    );
    assert.match(
      iconsSource,
      new RegExp(`^\\s*"?(?:${id})"?\\s*:\\s*\\w+,\\s*$|^\\s*${id},\\s*$`, "m"),
      `${id} should map directly to its bundled Install Helper icon`,
    );
    assert.match(
      readmeSource,
      new RegExp(`\`${asset}\``),
      `${asset} should have an icon provenance note`,
    );
  });
}

test("Oh My Posh icon retains its upstream MIT notice", async () => {
  const notice = await readFile(
    new URL(
      "../src/assets/installer-icons/LICENSE.oh-my-posh.txt",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(notice, /Copyright 2022 Jan De Dobbeleer/);
  assert.match(notice, /Permission is hereby granted, free of charge/);
});
