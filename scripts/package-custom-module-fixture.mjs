import { readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { zipSync } from "fflate";

const repositoryRoot = resolve(import.meta.dirname, "..");
const fixtureRoot = resolve(repositoryRoot, "custom-modules/fixtures/hello-world");
const outputPath = resolve(repositoryRoot, "custom-modules/fixtures/hello-world.kkmod");

async function collect(directory, output = {}) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(path, output);
    } else if (entry.isFile()) {
      output[relative(fixtureRoot, path).replaceAll("\\", "/")] = new Uint8Array(
        await readFile(path),
      );
    }
  }
  return output;
}

await writeFile(outputPath, zipSync(await collect(fixtureRoot), { level: 9 }));
console.log(relative(repositoryRoot, outputPath));
