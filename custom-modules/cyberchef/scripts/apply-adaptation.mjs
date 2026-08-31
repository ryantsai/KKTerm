import {execFileSync} from "node:child_process";
import {copyFile, readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";

const UPSTREAM_VERSION = "11.3.0";
const UPSTREAM_COMMIT = "d24ba1afce2e3a080308b5df7db033332fe94a1a";
const DISABLED_OPERATIONS = ["HTTP request", "DNS over HTTPS", "Show on map"];
const DISABLED_OPERATION_TESTS = ["ShowOnMap"];
const moduleRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(process.argv[2] || process.env.CYBERCHEF_SOURCE || "");

if (!process.argv[2] && !process.env.CYBERCHEF_SOURCE) {
    throw new Error("Pass the CyberChef checkout path or set CYBERCHEF_SOURCE.");
}

const packagePath = resolve(sourceRoot, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
if (packageJson.name !== "cyberchef" || packageJson.version !== UPSTREAM_VERSION) {
    throw new Error(`Expected the immutable CyberChef v${UPSTREAM_VERSION} source tree.`);
}
const sourceCommit = execFileSync("git", ["-c", `safe.directory=${sourceRoot.replaceAll("\\", "/")}`, "rev-parse", "HEAD"], {
    cwd: sourceRoot,
    encoding: "utf8"
}).trim();
if (sourceCommit !== UPSTREAM_COMMIT) {
    throw new Error(`Expected CyberChef commit ${UPSTREAM_COMMIT}; found ${sourceCommit}.`);
}

async function normalized(path) {
    return (await readFile(path, "utf8")).replaceAll("\r\n", "\n");
}

async function replaceOnce(path, before, after) {
    const source = await normalized(path);
    const matches = source.split(before).length - 1;
    if (matches === 0 && source.includes(after)) return;
    if (matches !== 1) {
        throw new Error(`Expected exactly one adaptation target in ${path}; found ${matches}.`);
    }
    await writeFile(path, source.replace(before, after), "utf8");
}

async function replaceEvery(path, before, after, expectedMatches) {
    const source = await normalized(path);
    const matches = source.split(before).length - 1;
    if (matches === 0 && source.split(after).length - 1 === expectedMatches) return;
    if (matches !== expectedMatches) {
        throw new Error(`Expected ${expectedMatches} adaptation targets in ${path}; found ${matches}.`);
    }
    await writeFile(path, source.replaceAll(before, after), "utf8");
}

async function replaceRegexOnce(path, expression, after, sentinel) {
    const source = await normalized(path);
    if (sentinel && source.includes(sentinel)) return;
    const flags = expression.flags.includes("g") ? expression.flags : `${expression.flags}g`;
    const matches = source.match(new RegExp(expression.source, flags));
    if (!matches || matches.length !== 1) {
        throw new Error(`Expected exactly one regex adaptation target in ${path}; found ${matches?.length ?? 0}.`);
    }
    await writeFile(path, source.replace(expression, after), "utf8");
}

const workerImports = new Map([
    ["src/web/waiters/BackgroundWorkerWaiter.mjs", 1],
    ["src/web/waiters/InputWaiter.mjs", 2],
    ["src/web/waiters/WorkerWaiter.mjs", 2],
    ["src/web/waiters/OutputWaiter.mjs", 1]
]);
for (const [relativePath, count] of workerImports) {
    await replaceEvery(
        resolve(sourceRoot, relativePath),
        "worker-loader?inline=no-fallback!",
        "worker-loader!",
        count
    );
}

const indexPath = resolve(sourceRoot, "src/web/index.js");
await replaceOnce(
    indexPath,
    'import OperationConfig from "../core/config/OperationConfig.json" with { type: "json" };',
    'import OperationConfig from "../core/config/OperationConfig.json" with { type: "json" };\nimport {initializeKKTermRuntime} from "./kkterm-v2-adapter.mjs";'
);
await replaceOnce(
    indexPath,
    "function main() {\n    const defaultFavourites",
    "async function main() {\n    const kktermContext = await initializeKKTermRuntime();\n\n    const defaultFavourites"
);
await replaceOnce(indexPath, 'theme:               "classic",', "theme:               kktermContext.theme,");
await copyFile(
    resolve(moduleRoot, "src/kkterm-v2-adapter.mjs"),
    resolve(sourceRoot, "src/web/kkterm-v2-adapter.mjs")
);

const generateConfigPath = resolve(sourceRoot, "src/core/config/scripts/generateConfig.mjs");
await replaceOnce(
    generateConfigPath,
    "const operationConfig = {},\n    modules = {};",
    `const operationConfig = {},\n    modules = {};\n\n// KKTerm's local-only WebView grants no arbitrary network access.\nconst kktermDisabledOperations = new Set(${JSON.stringify(DISABLED_OPERATIONS).replaceAll(",", ", ")});`
);
await replaceOnce(
    generateConfigPath,
    "    const op = new Ops[opObj]();\n\n    operationConfig[op.name]",
    "    const op = new Ops[opObj]();\n    if (kktermDisabledOperations.has(op.name)) continue;\n\n    operationConfig[op.name]"
);

const generateOpsIndexPath = resolve(sourceRoot, "src/core/config/scripts/generateOpsIndex.mjs");
await replaceOnce(
    generateOpsIndexPath,
    "const testsDir = path.join(process.cwd() + \"/tests/operations/tests/\");\nconst testObjs = [];",
    `const testsDir = path.join(process.cwd() + "/tests/operations/tests/");\nconst testObjs = [];\n// The corresponding operation is intentionally unavailable in KKTerm's offline build.\nconst kktermDisabledOperationTests = new Set(${JSON.stringify(DISABLED_OPERATION_TESTS)});`
);
await replaceOnce(
    generateOpsIndexPath,
    "    if (!file.endsWith(\".mjs\")) return;\n    testObjs.push(file.split(\".mjs\")[0]);",
    "    if (!file.endsWith(\".mjs\")) return;\n    const testName = file.split(\".mjs\")[0];\n    if (kktermDisabledOperationTests.has(testName)) return;\n    testObjs.push(testName);"
);

const categoriesPath = resolve(sourceRoot, "src/core/config/Categories.json");
const categories = JSON.parse(await readFile(categoriesPath, "utf8"));
let removedOperations = 0;
for (const category of categories) {
    if (!Array.isArray(category.ops)) continue;
    const before = category.ops.length;
    category.ops = category.ops.filter(operation => !DISABLED_OPERATIONS.includes(operation));
    removedOperations += before - category.ops.length;
}
if (removedOperations !== DISABLED_OPERATIONS.length && removedOperations !== 0) {
    throw new Error(`Expected to remove ${DISABLED_OPERATIONS.length} network operations; removed ${removedOperations}.`);
}
await writeFile(categoriesPath, `${JSON.stringify(categories, null, 4)}\n`, "utf8");

// Jimp 1.6.1 rejects the same malformed fixture earlier, with a newer error message.
await replaceOnce(
    resolve(sourceRoot, "tests/operations/tests/Image.mjs"),
    'expectedOutput: "Error loading image. (Error: unrecognised content at end of stream)",',
    'expectedOutput: "Error loading image. (Error: Could not find MIME for Buffer)",'
);

const gruntPath = resolve(sourceRoot, "Gruntfile.js");
await replaceOnce(
    gruntPath,
    '    grunt.registerTask("node",',
    `    grunt.registerTask("kkmod",\n        "Creates the browser-only output used by the KKTerm Custom Module.",\n        ["eslint", "clean:prod", "clean:config", "exec:generateConfig", "findModules", "webpack:web"]);\n\n    grunt.registerTask("node",`
);

const webpackPath = resolve(sourceRoot, "webpack.config.js");
await replaceOnce(
    webpackPath,
    `        alias: {\n            jquery: "jquery/src/jquery",\n        },`,
    `        alias: {\n            jquery: "jquery/src/jquery",\n            // Jimp 1.6.1 accidentally publishes an empty browser-condition stub.\n            "jimp$": path.resolve(__dirname, "node_modules/jimp/dist/esm/index.js"),\n        },`
);
await replaceOnce(
    webpackPath,
    "                exclude: /node_modules\\/(?!crypto-api|bootstrap)/,",
    "                exclude: /node_modules[\\\\/](?!crypto-api|bootstrap)/,"
);
await replaceOnce(
    webpackPath,
    "                test: /(\\.fnt$|bmfonts\\/.+\\.png$)/,",
    "                test: /(\\.fnt$|bmfonts[\\\\/].+\\.png$)/,"
);

const htmlPath = resolve(sourceRoot, "src/web/html/index.html");
await replaceRegexOnce(
    htmlPath,
    /^\s*<a href="#" data-toggle="modal" data-target="#download-modal".*$/m,
    '                    <span id="kkterm-build-label" title="Unofficial local-only KKTerm integration; network-dependent operations are unavailable.">CyberChef v<%= htmlWebpackPlugin.options.latestReleaseVersion %> · KKTerm</span>',
    "kkterm-build-label"
);
await replaceRegexOnce(
    htmlPath,
    /\n        <div class="modal fade" id="download-modal"[\s\S]*?\n        <\/div>\n\n        <!-- The Help modal/,
    "\n\n        <!-- The Help modal",
    null
);
await replaceRegexOnce(
    htmlPath,
    /\n                        <div class="form-group option-item">\n                            <label for="theme"[\s\S]*?\n                        <\/div>\n/,
    "\n",
    null
);
await replaceOnce(
    htmlPath,
    "CyberChef can handle files up to around 2GB (depending on your browser), however some of the operations may take a very long time to run over this much data.",
    "This KKTerm integration accepts files smaller than 256 MiB. Some operations may still take a long time on large inputs."
);
await replaceOnce(
    htmlPath,
    'alert("Internet Explorer is not supported, please use Firefox or Chrome instead");',
    'console.error("Internet Explorer is not supported, please use Firefox or Chrome instead");'
);
await replaceRegexOnce(
    htmlPath,
    /<object id="bombe" data="([^\"]+)" width="100%" height="100%"([\s\S]*?)><\/object>/,
    '<img id="bombe" src="$1" width="100%" height="100%" alt=""$2>',
    null
);

const optionsPath = resolve(sourceRoot, "src/web/waiters/OptionsWaiter.mjs");
await replaceOnce(
    optionsPath,
    '        const themeSelect = document.getElementById("theme");\n        let themeOption',
    '        const themeSelect = document.getElementById("theme");\n        if (!themeSelect) return;\n        let themeOption'
);

const appPath = resolve(sourceRoot, "src/web/App.mjs");
await replaceOnce(
    appPath,
    "        if (silent) return;\n\n        this.snackbars.push",
    "        if (silent) return;\n        if (window.KKTermCyberChef?.notice(str)) return;\n\n        this.snackbars.push"
);

const loaderWorkerPath = resolve(sourceRoot, "src/web/workers/LoaderWorker.js");
await replaceOnce(loaderWorkerPath, "file.size >= 256*256*256*128", "file.size >= 256 * 1024 * 1024");
await replaceOnce(
    loaderWorkerPath,
    '"File size too large."',
    '"File size exceeds the 256 MiB KKTerm Module limit."'
);

const utilsPath = resolve(sourceRoot, "src/core/Utils.mjs");
await replaceOnce(
    utilsPath,
    "            return new Promise((resolve, reject) => {\n                const reader = new FileReader();",
    `            return new Promise((resolve, reject) => {\n                if (file.size >= 256 * 1024 * 1024) {\n                    reject("File size exceeds the 256 MiB KKTerm Module limit.");\n                    return;\n                }\n                const reader = new FileReader();`
);

await replaceOnce(
    resolve(sourceRoot, "src/core/operations/OpticalCharacterRecognition.mjs"),
    '                workerPath: `${assetDir}tesseract/worker.min.js`,\n                langPath:',
    '                workerPath: `${assetDir}tesseract/worker.min.js`,\n                workerBlobURL: false,\n                langPath:'
);

const outputPath = resolve(sourceRoot, "src/web/waiters/OutputWaiter.mjs");
await replaceOnce(
    outputPath,
    `        // Execute script sections\n        const outputHTML = document.getElementById("output-html");\n        const scriptElements = outputHTML ? outputHTML.querySelectorAll("script") : [];\n        for (let i = 0; i < scriptElements.length; i++) {\n            try {\n                eval(scriptElements[i].innerHTML); // eslint-disable-line no-eval\n            } catch (err) {\n                log.error(err);\n            }\n        }`,
    `        // Apply the packaged, CSP-safe presentation hooks.\n        const outputHTML = document.getElementById("output-html");\n        if (outputHTML) window.KKTermCyberChef?.enhanceOutput(outputHTML);`
);
await replaceOnce(
    outputPath,
    '        const fileName = window.prompt("Please enter a filename: ", `download${ext}`);\n\n        // Assume if the user clicks cancel they don\'t want to download\n        if (fileName === null) return;',
    "        // KKTerm's native save picker lets the user change this suggested filename.\n        const fileName = `download${ext}`;"
);
await replaceOnce(
    outputPath,
    `        let fileName = window.prompt("Please enter a filename: ", "download.zip");\n\n        if (fileName === null || fileName === "") {\n            // Don't zip the files if there isn't a filename\n            this.app.alert("No filename was specified.", 3000);\n            return;\n        }`,
    `        // KKTerm's native save picker lets the user change this suggested filename.\n        let fileName = "download.zip";`
);
await replaceOnce(
    outputPath,
    `        let fileExt = window.prompt("Please enter a file extension for the files, or leave blank to detect automatically.", "");\n\n        if (fileExt === null) fileExt = "";`,
    '        const fileExt = "";'
);
await replaceRegexOnce(
    outputPath,
    /    goToTab\(\) \{\n        const min = this\.getSmallestInputNum\(\),[\s\S]*?\n    \}\n\n    \/\*\*\n     \* Generates a list/,
    "    goToTab() {\n        this.findTab();\n    }\n\n    /**\n     * Generates a list",
    null
);

const inputPath = resolve(sourceRoot, "src/web/waiters/InputWaiter.mjs");
await replaceRegexOnce(
    inputPath,
    /    async goToTab\(\) \{\n        const inputNums = await this\.getInputNums\(\);[\s\S]*?\n    \}\n\n    \/\*\*\n     \* Handler for find tab/,
    "    async goToTab() {\n        this.findTab();\n    }\n\n    /**\n     * Handler for find tab",
    null
);

const presentationPatches = [
    ["src/core/operations/Entropy.mjs", "<canvas id='chart-area'></canvas>", "<canvas id='chart-area' data-kkterm-chart='entropy' data-value='${entropy}'></canvas>"],
    ["src/core/operations/FrequencyDistribution.mjs", "<canvas id='chart-area'></canvas>", "<canvas id='chart-area' data-kkterm-chart='frequency' data-values='${JSON.stringify(freq.percentages)}'></canvas>"],
    ["src/core/operations/IndexOfCoincidence.mjs", "<canvas id='chart-area'></canvas>", "<canvas id='chart-area' data-kkterm-chart='coincidence' data-value='${ic}'></canvas>"],
    ["src/core/operations/ParseColourCode.mjs", '<div id="colorpicker" style="white-space: normal;"></div>', '<div id="colorpicker" data-kkterm-colorpicker data-color="${rgba}" style="white-space: normal;"></div>']
];
for (const [relativePath, before, after] of presentationPatches) {
    const path = resolve(sourceRoot, relativePath);
    await replaceOnce(path, before, after);
    await replaceRegexOnce(path, /<script(?:\s[^>]*)?>[\s\S]*?<\/script>/, "", null);
}

await replaceOnce(
    resolve(sourceRoot, "src/core/operations/Magic.mjs"),
    '        output += "</table><script type=\'application/javascript\'>$(\'[data-toggle=\\"tooltip\\"]\').tooltip()</script>";',
    '        output += "</table>";'
);
await replaceOnce(
    resolve(sourceRoot, "src/core/operations/ShowBase64Offsets.mjs"),
    '            script = "<script type=\'application/javascript\'>$(\'[data-toggle=\\"tooltip\\"]\').tooltip()</script>";',
    '            script = "";'
);

packageJson.dependencies.dompurify = "3.4.14";
packageJson.dependencies.jimp = "1.6.1";
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

console.log(`Applied the KKTerm API v2 adaptation to CyberChef v${UPSTREAM_VERSION} at ${sourceRoot}`);
