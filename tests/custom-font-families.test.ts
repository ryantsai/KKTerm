import assert from "node:assert/strict";
import test from "node:test";

import {
  customFontDiagnostic,
  fontFaceDescriptors,
  normalizeAvailableTerminal,
  notifyCustomFontsLoaded,
  sanitizedFontLoadErrorName,
  terminalCustomFontOptions,
  toCustomFontOptions,
} from "../src/lib/customFonts.ts";
import { defaultTerminalSettings } from "../src/app-defaults.ts";
import type { CustomFont } from "../src/types.ts";

function face(overrides: Partial<CustomFont>): CustomFont {
  return {
    name: "MesloLGMNerdFontMono-Regular",
    family: "MesloLGM Nerd Font Mono",
    path: "C:/fonts/MesloLGMNerdFontMono-Regular.ttf",
    extension: "ttf",
    weight: 400,
    style: "normal",
    isMonospace: true,
    supportsNerdFontHome: true,
    ...overrides,
  };
}

test("custom font diagnostics omit paths and sanitize labels and errors", () => {
  const diagnostic = customFontDiagnostic(face({
    name: "Example\nRegular",
    family: "Example\tMono",
    path: "C:/Users/private-name/fonts/Example-Regular.ttf",
  }));

  assert.deepEqual(diagnostic, {
    fileName: "Example Regular",
    family: "Example Mono",
    extension: "ttf",
    weight: 400,
    style: "normal",
    isMonospace: true,
    supportsNerdFontHome: true,
  });
  assert.equal("path" in diagnostic, false);

  const error = new Error("C:/Users/private-name/fonts/Example-Regular.ttf failed");
  error.name = "NetworkError";
  assert.equal(sanitizedFontLoadErrorName(error), "NetworkError");
  assert.equal(sanitizedFontLoadErrorName({ name: "bad name: private detail" }), "Error");
});

test("custom font files are grouped by internal family with partial faces allowed", () => {
  const options = toCustomFontOptions([
    face({}),
    face({
      name: "MesloLGMNerdFontMono-Bold",
      path: "C:/fonts/MesloLGMNerdFontMono-Bold.ttf",
      weight: 700,
    }),
  ]);

  assert.equal(options.length, 1);
  assert.equal(options[0].name, "MesloLGM Nerd Font Mono");
  assert.equal(options[0].isMonospace, true);
  assert.deepEqual(options[0].faces.map((item) => item.weight), [400, 700]);
});

test("normal, mono, and proportional variants remain separate families", () => {
  const options = toCustomFontOptions([
    face({ family: "MesloLGM Nerd Font" }),
    face({ family: "MesloLGM Nerd Font Mono" }),
    face({ family: "MesloLGM Nerd Font Propo" }),
  ]);

  assert.deepEqual(options.map((option) => option.name), [
    "MesloLGM Nerd Font",
    "MesloLGM Nerd Font Mono",
    "MesloLGM Nerd Font Propo",
  ]);
});

test("font faces carry their available weight and style descriptors", () => {
  assert.deepEqual(
    fontFaceDescriptors(face({ weight: 700, style: "italic" })),
    { display: "swap", style: "italic", weight: "700" },
  );
});

test("custom font completion emits an explicit renderer refresh event", () => {
  const target = new EventTarget();
  let notifications = 0;
  target.addEventListener("kkterm:custom-fonts-loaded", () => notifications += 1);

  notifyCustomFontsLoaded(target);

  assert.equal(notifications, 1);
});

test("Terminal offers only custom families with fixed-width metadata", () => {
  const options = toCustomFontOptions([
    face({ family: "MesloLGM Nerd Font", isMonospace: false }),
    face({ family: "MesloLGM Nerd Font Mono", isMonospace: true }),
  ]);

  assert.deepEqual(terminalCustomFontOptions(options).map((option) => option.name), [
    "MesloLGM Nerd Font Mono",
  ]);
});

test("an existing proportional custom terminal family falls back without resetting other settings", () => {
  const settings = {
    ...defaultTerminalSettings,
    fontFamily: '"MesloLGM Nerd Font", monospace',
    fontSize: 16,
  };
  const options = toCustomFontOptions([
    face({ family: "MesloLGM Nerd Font", isMonospace: false }),
  ]);

  assert.deepEqual(normalizeAvailableTerminal(settings, options), {
    ...settings,
    fontFamily: defaultTerminalSettings.fontFamily,
  });
});
