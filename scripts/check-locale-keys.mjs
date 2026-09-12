#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = path.join(rootDir, "src", "i18n", "locales");
const sourceLocale = "en.json";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function flattenLeafKeys(value, prefix = "") {
  if (!isRecord(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return isRecord(child) ? flattenLeafKeys(child, nextPrefix) : [nextPrefix];
  });
}

async function readJson(fileName) {
  const filePath = path.join(localesDir, fileName);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read ${fileName}: ${error.message}`);
  }
}

function diffKeys(sourceKeys, localeKeys) {
  const source = new Set(sourceKeys);
  const locale = new Set(localeKeys);

  return {
    missing: sourceKeys.filter((key) => !locale.has(key)),
    redundant: localeKeys.filter((key) => !source.has(key)),
  };
}

function printKeyList(label, keys) {
  if (keys.length === 0) {
    return;
  }

  console.log(`  ${label} (${keys.length}):`);
  for (const key of keys) {
    console.log(`    - ${key}`);
  }
}

const localeFiles = (await readdir(localesDir))
  .filter((name) => name.endsWith(".json"))
  .sort((a, b) => a.localeCompare(b, "en"));

if (!localeFiles.includes(sourceLocale)) {
  throw new Error(`Missing source locale ${sourceLocale}`);
}

function findFirstOrderMismatch(sourceKeys, localeKeys) {
  const source = new Set(sourceKeys);
  const locale = new Set(localeKeys);
  const expected = sourceKeys.filter((key) => locale.has(key));
  const actual = localeKeys.filter((key) => source.has(key));

  for (let index = 0; index < Math.min(expected.length, actual.length); index += 1) {
    if (expected[index] !== actual[index]) {
      return {
        index,
        expected: expected[index],
        actual: actual[index],
      };
    }
  }

  return expected.length === actual.length
    ? null
    : {
        index: Math.min(expected.length, actual.length),
        expected: expected[Math.min(expected.length, actual.length)] ?? "<none>",
        actual: actual[Math.min(expected.length, actual.length)] ?? "<none>",
      };
}

const sourceKeysInOrder = flattenLeafKeys(await readJson(sourceLocale));
const sourceKeys = [...sourceKeysInOrder].sort();
let problemCount = 0;

for (const fileName of localeFiles) {
  if (fileName === sourceLocale) {
    continue;
  }

  const localeKeysInOrder = flattenLeafKeys(await readJson(fileName));
  const localeKeys = [...localeKeysInOrder].sort();
  const { missing, redundant } = diffKeys(sourceKeys, localeKeys);
  const orderMismatch = findFirstOrderMismatch(sourceKeysInOrder, localeKeysInOrder);

  if (missing.length === 0 && redundant.length === 0 && orderMismatch === null) {
    console.log(`${fileName}: OK (${localeKeys.length} keys)`);
    continue;
  }

  problemCount += missing.length + redundant.length + (orderMismatch === null ? 0 : 1);
  console.log(
    `${fileName}: ${missing.length} missing, ${redundant.length} redundant${
      orderMismatch === null ? "" : ", key order differs"
    }`,
  );
  printKeyList("Missing from locale", missing);
  printKeyList("Redundant in locale", redundant);
  if (orderMismatch !== null) {
    console.log(
      `  Key order first differs at shared index ${orderMismatch.index}: expected ${orderMismatch.expected}, found ${orderMismatch.actual}`,
    );
    console.log("  Run `pnpm run i18n:normalize` to mirror en.json key order.");
  }
}

if (problemCount > 0) {
  console.error(`Locale key check failed: ${problemCount} mismatch(es).`);
  process.exitCode = 1;
} else {
  console.log(`All locale files match ${sourceLocale} (${sourceKeys.length} keys).`);
}
