import {readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";

const sourceRoot = resolve(process.argv[2] || process.env.CYBERCHEF_SOURCE || "");
if (!process.argv[2] && !process.env.CYBERCHEF_SOURCE) {
    throw new Error("Pass the adapted CyberChef checkout path or set CYBERCHEF_SOURCE.");
}

async function verifyPackage(name, version) {
    const packagePath = resolve(sourceRoot, "node_modules", name, "package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    if (packageJson.name !== name || packageJson.version !== version) {
        throw new Error(`Expected ${name} ${version}; found ${packageJson.name} ${packageJson.version}.`);
    }
}

async function replaceOnce(path, before, after) {
    const source = (await readFile(path, "utf8")).replaceAll("\r\n", "\n");
    const matches = source.split(before).length - 1;
    if (matches === 0 && source.includes(after)) return;
    if (matches !== 1) {
        throw new Error(`Expected exactly one dependency adaptation target in ${path}; found ${matches}.`);
    }
    await writeFile(path, source.replace(before, after), "utf8");
}

await verifyPackage("@wavesenterprise/crypto-gost-js", "2.1.0-RC1");
await verifyPackage("jq-web", "0.5.1");
await verifyPackage("tesseract.js", "7.0.0");
await verifyPackage("tesseract.js-core", "7.0.0");
await verifyPackage("zlibjs", "0.3.1");

await replaceOnce(
    resolve(sourceRoot, "node_modules/tesseract.js/src/worker/browser/spawnWorker.js"),
    `  let worker;\n  if (Blob && URL && workerBlobURL) {\n    const blob = new Blob([\`importScripts("\${workerPath}");\`], {\n      type: 'application/javascript',\n    });\n    worker = new Worker(URL.createObjectURL(blob));\n  } else {\n    worker = new Worker(workerPath);\n  }\n\n  return worker;`,
    `  // KKTerm permits dedicated workers only from packaged module URLs.\n  void workerBlobURL;\n  return new Worker(workerPath);`
);
await replaceOnce(
    resolve(sourceRoot, "node_modules/@wavesenterprise/crypto-gost-js/dist/CryptoGost.js"),
    "    return eval(this.code); // maybe...",
    '    throw new Error("Dynamic code execution is disabled by the KKTerm Module CSP.");'
);
await replaceOnce(
    resolve(sourceRoot, "node_modules/zlibjs/bin/unzip.min.js"),
    'eval("String.fromCharCode.apply(null, new Uint8Array([0]));")',
    "String.fromCharCode.apply(null,new Uint8Array([0]))"
);
await replaceOnce(
    resolve(sourceRoot, "node_modules/jq-web/jq.asm.bundle.min.js"),
    'window.prompt("Input: ")',
    "null"
);
await replaceOnce(
    resolve(sourceRoot, "node_modules/tesseract.js-core/tesseract-core.wasm.js"),
    'window.prompt("Input: ")',
    "null"
);

console.log(`Applied CSP-safe dependency adaptations under ${sourceRoot}`);
