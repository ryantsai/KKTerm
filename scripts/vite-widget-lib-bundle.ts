// Vite plugin that bundles a CJS / multi-file npm package into a single
// self-contained IIFE source string at build time, exposed as the default
// export of a virtual module.
//
// Usage in TypeScript:
//   import qrcodeSource from "widget-lib:qrcode?global=QRCode";
//
// The plugin invokes esbuild (a direct devDependency, deduped with the copy
// Vite resolves) with bundle=true and format=iife. The IIFE assigns its
// result to the requested global on window, matching the runtime contract
// widget libraries rely on inside the sandbox.

import { build } from "esbuild";
import type { Plugin } from "vite";

const PREFIX = "widget-lib:";

function parseSpec(id: string): { pkg: string; globalName: string } | null {
  if (!id.startsWith(PREFIX)) return null;
  const rest = id.slice(PREFIX.length);
  const [pkg, query] = rest.split("?");
  if (!pkg) return null;
  const params = new URLSearchParams(query ?? "");
  const globalName = params.get("global");
  if (!globalName) return null;
  return { pkg, globalName };
}

export function widgetLibBundlePlugin(): Plugin {
  const cache = new Map<string, string>();
  return {
    name: "kkterm-widget-lib-bundle",
    enforce: "pre",
    resolveId(id) {
      if (id.startsWith(PREFIX)) return "\0" + id;
      return null;
    },
    async load(id) {
      if (!id.startsWith("\0" + PREFIX)) return null;
      const spec = parseSpec(id.slice(1));
      if (!spec) return null;
      const cacheKey = `${spec.pkg}:${spec.globalName}`;
      let bundled = cache.get(cacheKey);
      if (!bundled) {
        const result = await build({
          stdin: {
            contents: `module.exports = require(${JSON.stringify(spec.pkg)});`,
            resolveDir: process.cwd(),
            loader: "js",
          },
          bundle: true,
          format: "iife",
          globalName: "__kkWidgetLibExport",
          platform: "browser",
          minify: true,
          write: false,
          target: ["es2020"],
          legalComments: "none",
        });
        const iifeBody = result.outputFiles[0]?.text ?? "";
        // The IIFE assigns its module.exports to __kkWidgetLibExport. We then
        // re-expose that under the documented widget global, and tolerate the
        // case where the module's default-export is a single function rather
        // than an object.
        bundled =
          iifeBody +
          `\nwindow[${JSON.stringify(spec.globalName)}]=` +
          `(typeof __kkWidgetLibExport!=="undefined"&&__kkWidgetLibExport&&` +
          `Object.prototype.hasOwnProperty.call(__kkWidgetLibExport,"default")` +
          `?__kkWidgetLibExport.default:__kkWidgetLibExport);`;
        cache.set(cacheKey, bundled);
      }
      return `export default ${JSON.stringify(bundled)};`;
    },
  };
}
