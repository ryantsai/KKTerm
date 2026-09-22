import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'node_modules/pica/package.json'), 'utf8'));
if (packageJson.name !== 'pica' || packageJson.version !== '7.1.1') {
  throw new Error('Expected pica 7.1.1 before adapting its worker mode.');
}
const reducerJson = JSON.parse(await readFile(resolve(root, 'node_modules/image-blob-reduce/package.json'), 'utf8'));
if (reducerJson.name !== 'image-blob-reduce' || reducerJson.version !== '3.0.1') {
  throw new Error('Expected image-blob-reduce 3.0.1 before adapting its worker mode.');
}

const before = '  this.__requested_features = features;';
const after = "  // webworkify creates Blob workers, which the KKMod CSP blocks.\n  features = features.filter(feature => feature !== 'ww');\n\n" + before;
for (const relative of [
  'node_modules/pica/index.js',
  'node_modules/pica/dist/pica.js',
  'node_modules/image-blob-reduce/dist/image-blob-reduce.esm.mjs',
]) {
  const path = resolve(root, relative);
  const source = await readFile(path, 'utf8');
  if (source.includes(after)) continue;
  if (source.split(before).length !== 2) {
    throw new Error(`Expected one pica worker feature target in ${relative}.`);
  }
  await writeFile(path, source.replace(before, after), 'utf8');
}
