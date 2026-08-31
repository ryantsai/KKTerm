import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {readdir, readFile, stat, writeFile} from "node:fs/promises";
import {resolve} from "node:path";

const moduleRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(process.argv[2] || process.env.CYBERCHEF_SOURCE || "");
if (!process.argv[2] && !process.env.CYBERCHEF_SOURCE) {
    throw new Error("Pass the adapted CyberChef checkout path or set CYBERCHEF_SOURCE.");
}

const lock = JSON.parse(await readFile(resolve(sourceRoot, "package-lock.json"), "utf8"));
const runtimeBuildPackages = new Set([
    "node_modules/@babel/runtime",
    "node_modules/core-js",
    "node_modules/mini-css-extract-plugin",
    "node_modules/webpack",
    "node_modules/worker-loader"
]);

function licenseExpression(packageJson) {
    const value = packageJson.license ?? packageJson.licenses;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
        const expressions = value
            .map(entry => typeof entry === "string" ? entry : entry?.type)
            .filter(Boolean);
        if (expressions.length) return expressions.join(" OR ");
    }
    return "NOASSERTION";
}

function repositoryUrl(packageJson) {
    if (typeof packageJson.repository === "string") return packageJson.repository;
    return packageJson.repository?.url || packageJson.homepage || "";
}

async function licenseFiles(directory) {
    const files = [];
    for (const name of await readdir(directory)) {
        if (!/^(licen[cs]e|copying|notice|copyright)(\.|$)/i.test(name)) continue;
        const path = resolve(directory, name);
        if ((await stat(path)).isFile()) {
            files.push({name, text: (await readFile(path, "utf8")).replaceAll("\r\n", "\n").trimEnd()});
        }
    }
    return files.sort((left, right) => left.name.localeCompare(right.name));
}

const packages = new Map();
const licenseTexts = new Map();
for (const [relativePath, entry] of Object.entries(lock.packages)) {
    if (!relativePath.startsWith("node_modules/")) continue;
    if (entry.dev && !runtimeBuildPackages.has(relativePath)) continue;
    const directory = resolve(sourceRoot, relativePath);
    const packagePath = resolve(directory, "package.json");
    if (!existsSync(packagePath)) {
        if (!entry.optional) throw new Error(`Packaged dependency is missing: ${relativePath}`);
        continue;
    }
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    const key = `${packageJson.name}@${packageJson.version}`;
    const hashes = [];
    for (const file of await licenseFiles(directory)) {
        const hash = createHash("sha256").update(file.text).digest("hex");
        hashes.push(hash);
        if (!licenseTexts.has(hash)) licenseTexts.set(hash, file);
    }
    packages.set(key, {
        license: licenseExpression(packageJson),
        repository: repositoryUrl(packageJson),
        hashes: [...new Set(hashes)].sort()
    });
}

const sections = [
    "KKTerm CyberChef Custom Module — third-party notices",
    "====================================================",
    "",
    "Generated from the adapted CyberChef v11.3.0 package-lock.json and installed",
    "browser dependency tree. This is an unofficial KKTerm integration.",
    "",
    "Vendored browser components",
    "---------------------------",
    (await readFile(resolve(moduleRoot, "licenses/VENDORED_COMPONENTS.md"), "utf8")).trimEnd(),
    "",
    "Packaged dependency inventory",
    "-----------------------------"
];

for (const [key, item] of [...packages.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const details = [`License: ${item.license}`];
    if (item.repository) details.push(`Source: ${item.repository}`);
    if (item.hashes.length) details.push(`License text SHA-256: ${item.hashes.join(", ")}`);
    sections.push("", key, ...details);
}

sections.push("", "Deduplicated license and notice texts", "-----------------------------------");
for (const [hash, item] of [...licenseTexts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    sections.push("", `[${item.name}; SHA-256 ${hash}]`, item.text);
}

await writeFile(
    resolve(moduleRoot, "licenses/THIRD_PARTY_NOTICES.txt"),
    `${sections.join("\n")}\n`,
    "utf8"
);
console.log(`Wrote notices for ${packages.size} packaged dependencies and ${licenseTexts.size} unique texts.`);
