import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
const fontNotices = await readFile(resolve(root, "licenses/FONT_NOTICES.txt"), "utf8");
const moduleLicense = await readFile(resolve(root, "licenses/LICENSE"), "utf8");

function licenseExpression(packageJson) {
  const value = packageJson.license ?? packageJson.licenses;
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value) && value.length > 0) {
    return value
      .map((entry) => (typeof entry === "string" ? entry : entry.type))
      .filter(Boolean)
      .join(" OR ");
  }
  if (packageJson.name === "khroma") {
    // khroma 2.1.0 ships an MIT license file and README notice but omits the
    // package.json license field.
    return "MIT";
  }
  throw new Error(`${packageJson.name}@${packageJson.version} has no license metadata`);
}

function repositoryUrl(packageJson) {
  const value = packageJson.repository;
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value.url === "string") {
    return value.url;
  }
  return "";
}

async function licenseFiles(directory) {
  const results = [];
  for (const name of await readdir(directory)) {
    if (!/^(licen[cs]e|copying|notice)(\.|$)/i.test(name)) {
      continue;
    }
    const path = resolve(directory, name);
    if ((await stat(path)).isFile()) {
      results.push({ name, text: await readFile(path, "utf8") });
    }
  }
  return results.sort((left, right) => left.name.localeCompare(right.name));
}

const packages = [];
for (const [relativePath, entry] of Object.entries(lock.packages)) {
  if (!relativePath.startsWith("node_modules/") || entry.dev) {
    continue;
  }
  const directory = resolve(root, relativePath);
  const packageJsonPath = resolve(directory, "package.json");
  if (!existsSync(packageJsonPath)) {
    if (!entry.optional) {
      throw new Error(`Production dependency is not installed: ${relativePath}`);
    }
    continue;
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packages.push({
    key: `${packageJson.name}@${packageJson.version}`,
    name: packageJson.name,
    version: packageJson.version,
    license: licenseExpression(packageJson),
    author: typeof packageJson.author === "string"
      ? packageJson.author
      : packageJson.author?.name ?? "",
    repository: repositoryUrl(packageJson),
    files: await licenseFiles(directory),
  });
}

const uniquePackages = [...new Map(packages.map((item) => [item.key, item])).values()]
  .sort((left, right) => left.key.localeCompare(right.key));

const scopeFallbacks = new Map();
const licenseFallbacks = new Map();
for (const item of uniquePackages) {
  if (item.files.length === 0) {
    continue;
  }
  const scope = item.name.startsWith("@") ? item.name.split("/")[0] : "";
  if (scope && !scopeFallbacks.has(scope)) {
    scopeFallbacks.set(scope, item.files);
  }
  if (!licenseFallbacks.has(item.license)) {
    licenseFallbacks.set(item.license, item.files);
  }
}

const sections = [
  "KKTerm Excalidraw Custom Module — third-party notices",
  "====================================================",
  "",
  "Generated from package-lock.json and the installed production dependency tree.",
  "The Module is an unofficial integration and is not affiliated with Excalidraw.",
  "",
  fontNotices.trimEnd(),
  "",
  "JavaScript dependency notices",
  "=============================",
];

for (const item of uniquePackages) {
  const scope = item.name.startsWith("@") ? item.name.split("/")[0] : "";
  let files = item.files;
  let fallbackLabel = "";
  if (files.length === 0 && item.name === "@excalidraw/excalidraw") {
    files = [{ name: "Excalidraw repository LICENSE", text: moduleLicense }];
  } else if (files.length === 0 && scopeFallbacks.has(scope)) {
    files = scopeFallbacks.get(scope);
    fallbackLabel = `Shared ${scope} license text:`;
  } else if (files.length === 0 && licenseFallbacks.has(item.license)) {
    files = licenseFallbacks.get(item.license);
    fallbackLabel = `Shared ${item.license} license text:`;
  } else if (files.length === 0) {
    throw new Error(`No license text available for ${item.key}`);
  }

  sections.push("", item.key, "-".repeat(item.key.length), `License: ${item.license}`);
  if (item.author) {
    sections.push(`Author: ${item.author}`);
  }
  if (item.repository) {
    sections.push(`Source: ${item.repository}`);
  }
  if (fallbackLabel) {
    sections.push(fallbackLabel);
  }
  for (const file of files) {
    sections.push("", `[${file.name}]`, file.text.trimEnd());
  }
}

await writeFile(
  resolve(root, "licenses/THIRD_PARTY_NOTICES.txt"),
  `${sections.join("\n")}\n`,
  "utf8",
);

console.log(`Wrote notices for ${uniquePackages.length} production packages.`);
