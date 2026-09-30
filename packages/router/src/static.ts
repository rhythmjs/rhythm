import { join, normalize, sep } from "node:path";
import type { ServeMiddleware } from "./serve";

export interface StaticMiddlewareOptions {
  dir: string;
  prefix?: string;
  index?: string;
  maxAge?: number;
  immutable?: boolean;
  etag?: boolean;
}

function normalizePrefix(prefix: string): string {
  const withLeading = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
}

export function staticMiddleware(options: StaticMiddlewareOptions): ServeMiddleware {
  const prefix = normalizePrefix(options.prefix ?? "/");
  const index = options.index ?? "index.html";
  const useEtag = options.etag ?? true;
  const cacheControl =
    options.maxAge === undefined ? undefined : `max-age=${options.maxAge}${options.immutable ? ", immutable" : ""}`;

  return async (request, next) => {
    if (request.method !== "GET" && request.method !== "HEAD") return next();

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return next();
    }
    if (prefix !== "" && pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return next();
    const relative = normalize(pathname.slice(prefix.length));
    if (relative.includes("\0") || relative === ".." || relative.startsWith(`..${sep}`)) return next();

    const base = join(options.dir, relative);
    const candidates = pathname.endsWith("/") ? [join(base, index)] : [base, join(base, index)];
    let file: ReturnType<typeof Bun.file> | undefined;
    for (const candidate of candidates) {
      const found = Bun.file(candidate);
      if (await found.exists()) {
        file = found;
        break;
      }
    }
    if (file === undefined) return next();

    const headers = new Headers();
    if (cacheControl !== undefined) headers.set("cache-control", cacheControl);
    if (useEtag) {
      const etag = `"${file.size.toString(16)}-${Math.floor(file.lastModified).toString(16)}"`;
      headers.set("etag", etag);
      if (request.headers.get("if-none-match") === etag) {
        return new Response(null, { status: 304, headers });
      }
    }
    return new Response(file, { headers });
  };
}
