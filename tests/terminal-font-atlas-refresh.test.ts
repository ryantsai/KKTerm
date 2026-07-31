import assert from "node:assert/strict";
import test from "node:test";

import { refreshTerminalFontAtlases } from "../src/modules/workspace/connections/terminal/fontAtlasRefresh.ts";

test("shared terminal font atlases wait for fonts and release every renderer before restoring", async () => {
  const calls: string[] = [];
  const fontReadyResolvers: Array<() => void> = [];
  const targets = ["powershell", "cmd"].map((name, index) => ({
    waitForConfiguredFont: () => new Promise<void>((resolve) => {
      calls.push(`wait:${name}`);
      fontReadyResolvers.push(resolve);
    }),
    releaseFontAtlas: () => {
      calls.push(`release:${name}`);
      return index === 0;
    },
    restoreFontAtlas: (wasWebglEnabled: boolean) => calls.push(`restore:${name}:${wasWebglEnabled}`),
    redraw: () => calls.push(`redraw:${name}`),
  }));

  const refresh = refreshTerminalFontAtlases(targets);
  assert.deepEqual(calls, ["wait:powershell", "wait:cmd"]);

  fontReadyResolvers[0]();
  await Promise.resolve();
  assert.deepEqual(calls, ["wait:powershell", "wait:cmd"]);

  fontReadyResolvers[1]();
  await refresh;

  assert.deepEqual(calls, [
    "wait:powershell",
    "wait:cmd",
    "release:powershell",
    "release:cmd",
    "restore:powershell:true",
    "restore:cmd:false",
    "redraw:powershell",
    "redraw:cmd",
  ]);
});

test("a renderer joining while fonts load is included before any shared atlas is released", async () => {
  const calls: string[] = [];
  let resolveFirst = () => undefined;
  let resolveJoined = () => undefined;
  const target = (name: string, setResolver: (resolve: () => void) => void) => ({
    waitForConfiguredFont: () => new Promise<void>((resolve) => {
      calls.push(`wait:${name}`);
      setResolver(resolve);
    }),
    releaseFontAtlas: () => {
      calls.push(`release:${name}`);
      return true;
    },
    restoreFontAtlas: () => calls.push(`restore:${name}`),
    redraw: () => calls.push(`redraw:${name}`),
  });
  const targets = new Set([target("first", (resolve) => { resolveFirst = resolve; })]);

  const refresh = refreshTerminalFontAtlases(targets);
  targets.add(target("joined", (resolve) => { resolveJoined = resolve; }));
  resolveFirst();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, ["wait:first", "wait:joined"]);
  resolveJoined();
  await refresh;

  assert.deepEqual(calls, [
    "wait:first",
    "wait:joined",
    "release:first",
    "release:joined",
    "restore:first",
    "restore:joined",
    "redraw:first",
    "redraw:joined",
  ]);
});
