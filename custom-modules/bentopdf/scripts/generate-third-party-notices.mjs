import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const moduleRoot = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(process.argv[2] || process.env.BENTOPDF_SOURCE || '');
if (!process.argv[2] && !process.env.BENTOPDF_SOURCE) {
  throw new Error('Pass the adapted BentoPDF checkout path or set BENTOPDF_SOURCE.');
}

const lock = JSON.parse(await readFile(resolve(sourceRoot, 'package-lock.json'), 'utf8'));

function licenseExpression(packageJson) {
  const value = packageJson.license ?? packageJson.licenses;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const expressions = value
      .map((entry) => (typeof entry === 'string' ? entry : entry?.type))
      .filter(Boolean);
    if (expressions.length) return expressions.join(' OR ');
  }
  return 'NOASSERTION';
}

function repositoryUrl(packageJson) {
  if (typeof packageJson.repository === 'string') return packageJson.repository;
  return packageJson.repository?.url || packageJson.homepage || '';
}

async function licenseFiles(directory) {
  const files = [];
  for (const name of await readdir(directory)) {
    if (!/^(licen[cs]e|copying|notice|copyright)(\.|$)/i.test(name)) continue;
    const path = resolve(directory, name);
    if ((await stat(path)).isFile()) files.push({ name, text: await readFile(path, 'utf8') });
  }
  return files;
}

const packages = new Map();
const texts = new Map();
for (const [relativePath, entry] of Object.entries(lock.packages)) {
  if (!relativePath.startsWith('node_modules/') || entry.dev) continue;
  const directory = resolve(sourceRoot, relativePath);
  const packagePath = resolve(directory, 'package.json');
  if (!existsSync(packagePath)) {
    if (!entry.optional) throw new Error(`Production dependency is missing: ${relativePath}`);
    continue;
  }
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  const key = `${packageJson.name}@${packageJson.version}`;
  const hashes = [];
  for (const file of await licenseFiles(directory)) {
    const normalized = file.text.replace(/\r\n/g, '\n').trimEnd();
    const hash = createHash('sha256').update(normalized).digest('hex');
    hashes.push(hash);
    if (!texts.has(hash)) texts.set(hash, { name: file.name, text: normalized });
  }
  packages.set(key, {
    license: licenseExpression(packageJson),
    repository: repositoryUrl(packageJson),
    hashes: [...new Set(hashes)].sort(),
  });
}

const sections = [
  'KKTerm BentoPDF Custom Module — third-party notices',
  '==================================================',
  '',
  'Generated from the adapted BentoPDF v2.8.7 package-lock.json and installed',
  'production dependency tree. This is an unofficial KKTerm integration.',
  '',
  'Vendored browser runtimes',
  '-------------------------',
  await readFile(resolve(moduleRoot, 'licenses/VENDORED_COMPONENTS.md'), 'utf8'),
  '',
  'Production package inventory',
  '----------------------------',
];

for (const [key, item] of [...packages.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const details = [`License: ${item.license}`];
  if (item.repository) details.push(`Source: ${item.repository}`);
  if (item.hashes.length) details.push(`License text SHA-256: ${item.hashes.join(', ')}`);
  sections.push('', key, ...details);
}

sections.push('', 'Deduplicated license and notice texts', '-----------------------------------');
for (const [hash, item] of [...texts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  sections.push('', `[${item.name}; SHA-256 ${hash}]`, item.text);
}

await writeFile(
  resolve(moduleRoot, 'licenses/THIRD_PARTY_NOTICES.txt'),
  `${sections.join('\n')}\n`,
  'utf8'
);

console.log(`Wrote notices for ${packages.size} production packages and ${texts.size} unique texts.`);
