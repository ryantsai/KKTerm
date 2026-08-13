import assert from "node:assert/strict";
import test from "node:test";
import {
  customModuleDestinationKey,
  customModuleDestinations,
} from "../src/modules/custom-modules/useCustomModules";
import type { InstalledCustomModule } from "../src/modules/custom-modules/types";

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
    apiVersion: 1,
    license: { name: "MIT", file: "licenses/LICENSE" },
    permissions: [],
    modules: [
      {
        id: "main",
        title: "Main",
        entrypoint: "dist/index.html",
        railVisible: true,
      },
    ],
    source: "local",
    trust: "local",
    enabled: true,
    railVisible: true,
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

test("disabled, hidden, missing, and contribution-hidden Modules stay off the rail", () => {
  const destinations = customModuleDestinations([
    installed("com.example.disabled", { enabled: false }),
    installed("com.example.hidden", { railVisible: false }),
    installed("com.example.missing", { health: "missing" }),
    installed("com.example.contribution", {
      modules: [
        {
          id: "main",
          title: "Main",
          entrypoint: "dist/index.html",
          railVisible: false,
        },
      ],
    }),
  ]);
  assert.deepEqual(destinations, []);
});
