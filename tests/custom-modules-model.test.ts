import assert from "node:assert/strict";
import test from "node:test";
import {
  customModuleDestinationKey,
  customModuleDestinations,
} from "../src/modules/custom-modules/useCustomModules";
import type { InstalledCustomModule } from "../src/modules/custom-modules/types";

const emptyPermissions: InstalledCustomModule["permissions"] = {
  storage: false,
  documentStorage: false,
  blobStorage: false,
  browserStorage: false,
  openExternal: false,
  clipboard: false,
  secretReferences: false,
  hostUi: false,
};

function installed(
  id: string,
  overrides: Partial<InstalledCustomModule> = {},
): InstalledCustomModule {
  return {
    id,
    name: id,
    version: "1.0.0",
    publisher: "Fixture",
    summary: "",
    apiVersion: 2,
    license: { name: "MIT", file: "licenses/LICENSE" },
    permissions: emptyPermissions,
    modules: [
      {
        id: "main",
        title: "Main",
        entrypoint: "dist/index.html",
        railVisible: true,
        routing: "static",
      },
    ],
    source: "local",
    trust: "local",
    enabled: true,
    sha256: "hash",
    health: "ready",
    ...overrides,
  };
}

test("Custom Module rail normalization preserves installed order and namespaces ids", () => {
  const destinations = customModuleDestinations([
    installed("com.example.first"),
    installed("com.example.second"),
  ]);
  assert.deepEqual(
    destinations.map(customModuleDestinationKey),
    ["custom:com.example.first:main", "custom:com.example.second:main"],
  );
});

test("Custom Module rail normalization carries validated packaged icon data", () => {
  const [destination] = customModuleDestinations([
    installed("com.kkterm.fixture", {
      iconDataUrls: { main: "data:image/svg+xml;base64,PHN2Zy8+" },
    }),
  ]);
  assert.equal(destination.iconDataUrl, "data:image/svg+xml;base64,PHN2Zy8+");
});

test("enabled Modules always appear while disabled, missing, and contribution-hidden Modules do not", () => {
  const destinations = customModuleDestinations([
    installed("com.example.disabled", { enabled: false }),
    installed("com.example.missing", { health: "missing" }),
    installed("com.example.contribution", {
      modules: [
        {
          id: "main",
          title: "Main",
          entrypoint: "dist/index.html",
          railVisible: false,
          routing: "static",
        },
      ],
    }),
  ]);
  assert.deepEqual(destinations, []);
});
