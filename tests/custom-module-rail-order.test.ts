import assert from "node:assert/strict";
import test from "node:test";
import {
  orderCustomModuleDestinations,
  reorderCustomModuleDestinations,
} from "../src/app/customModuleRailOrder";
import type { CustomModuleDestination } from "../src/modules/custom-modules/types";

const alpha: CustomModuleDestination = {
  moduleId: "com.example.alpha",
  contributionId: "main",
  title: "Alpha",
};
const beta: CustomModuleDestination = {
  moduleId: "com.example.beta",
  contributionId: "main",
  title: "Beta",
};
const gamma: CustomModuleDestination = {
  moduleId: "com.example.gamma",
  contributionId: "main",
  title: "Gamma",
};

test("stored Custom Module order is normalized to installed destinations", () => {
  const ordered = orderCustomModuleDestinations(
    [alpha, beta, gamma],
    [
      "custom:com.example.gamma:main",
      "custom:missing:main",
      "custom:com.example.gamma:main",
    ],
  );
  assert.deepEqual(ordered, [gamma, alpha, beta]);
});

test("Custom Module destinations reorder only among Custom Module keys", () => {
  const reordered = reorderCustomModuleDestinations(
    [alpha, beta, gamma],
    undefined,
    "custom:com.example.gamma:main",
    "custom:com.example.beta:main",
  );
  assert.deepEqual(reordered, [
    "custom:com.example.alpha:main",
    "custom:com.example.gamma:main",
    "custom:com.example.beta:main",
  ]);
  assert.ok(reordered.every((key) => key.startsWith("custom:")));
});
