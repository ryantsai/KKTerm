import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
const destination = resolve(root, "dist/fonts");

await mkdir(destination, { recursive: true });
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "Liberation") {
    continue;
  }
  await cp(resolve(source, entry.name), resolve(destination, entry.name), {
    recursive: true,
  });
}

const assets = resolve(root, "dist/assets");
const assetNames = await readdir(assets);
for (const prefix of ["pica-", "image-blob-reduce.esm-"]) {
  const bundles = assetNames.filter((name) => name.startsWith(prefix) && name.endsWith(".js"));
  if (bundles.length !== 1) {
    throw new Error(`Expected one ${prefix} bundle; found ${bundles.length}.`);
  }
  const bundle = await readFile(resolve(assets, bundles[0]), "utf8");
  if (!/\.filter\([^)]*=>[^)]*!==[`'"]ww[`'"]\)/.test(bundle)) {
    throw new Error(`${bundles[0]} did not disable pica Blob workers.`);
  }
}
