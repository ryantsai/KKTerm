import { cp, mkdir, readdir } from "node:fs/promises";
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
