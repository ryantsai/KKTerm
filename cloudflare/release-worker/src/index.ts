import {
  cacheControlForKey,
  contentTypeForKey,
  parseReleaseObjectPath,
  shouldReturnPartialContent,
} from "./response";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const key = parseReleaseObjectPath(url.pathname);
    if (!key) {
      // Not a release download path (e.g. "/", "/css/style.css") — serve the
      // static marketing site from ./www. Falls through to Cloudflare's
      // built-in 404 handling for paths that match no asset file.
      return env.ASSETS.fetch(request);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    const object = await env.RELEASES.get(key, {
      onlyIf: request.headers,
      range: request.headers,
    });
    if (!object) return new Response("Not found", { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("accept-ranges", "bytes");
    headers.set("cache-control", cacheControlForKey(key));
    headers.set("access-control-allow-origin", "*");
    headers.set("content-type", contentTypeForKey(key));
    headers.set("x-content-type-options", "nosniff");
    if (key !== "releases/latest.json" && key !== "releases/latest-tauri.json") {
      headers.set("content-disposition", `attachment; filename="${key.split("/").at(-1)}"`);
    }

    if (!object.body) {
      return new Response(null, {
        status: request.headers.has("if-none-match") ? 304 : 412,
        headers,
      });
    }

    let status = 200;
    if (
      shouldReturnPartialContent(request.headers.get("range"), object.range) &&
      object.range &&
      "offset" in object.range &&
      "length" in object.range
    ) {
      status = 206;
      const end = object.range.offset + object.range.length - 1;
      headers.set("content-range", `bytes ${object.range.offset}-${end}/${object.size}`);
      headers.set("content-length", String(object.range.length));
    } else {
      headers.set("content-length", String(object.size));
    }
    return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
  },
} satisfies ExportedHandler<Env>;
