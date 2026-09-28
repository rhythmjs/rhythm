import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Rhythm } from "@rhythmjs/rhythm";
import { RhythmResponse, toResponse, type RhythmHttpContext } from "./context";

const DEFAULT_BODY_LIMIT = 1024 * 1024; // 1mb, same default raw-body/koa-bodyparser use

export class RhythmBodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`request body exceeds the ${limit} byte limit`);
    this.name = "RhythmBodyTooLargeError";
  }
}

// Buffers the body eagerly, the same way raw-body (which koa-bodyparser/co-body build
// on) does: plain 'data'/'end' listeners on the raw Node stream, not Readable.toWeb().
// This guarantees the socket is fully drained before the handler runs, regardless of
// whether the handler ever reads ctx.request's body - otherwise, on a keep-alive
// connection, unconsumed bytes left on the socket stall the next request on it.
function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let tooLarge = false;
    let settled = false;

    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > limit) {
        // Keep draining (discarding, not buffering) rather than destroying the
        // socket outright - destroying mid-upload races the client's still-in-flight
        // write and produces an abrupt ECONNRESET instead of a clean 413 response.
        if (!tooLarge) {
          tooLarge = true;
          settled = true;
          reject(new RhythmBodyTooLargeError(limit));
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    req.on("aborted", () => {
      if (settled) return;
      settled = true;
      reject(new Error("request aborted"));
    });
  });
}

async function toWebRequest(req: IncomingMessage, bodyLimit: number | false): Promise<Request> {
  const method = req.method ?? "GET";
  const host = req.headers.host ?? "localhost";
  const url = `http://${host}${req.url ?? "/"}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
    } else {
      headers.set(key, value);
    }
  }

  const hasBody = method !== "GET" && method !== "HEAD";
  if (!hasBody) return new Request(url, { method, headers });

  if (bodyLimit === false) {
    // Streaming opt-out: no buffering, no size limit, no automatic drain if the
    // handler never reads ctx.request's body - the caller owns that trade-off in
    // exchange for being able to pass a large body through (uploads, proxying)
    // without materializing it in memory. Same caveat Koa's own core carries.
    return new Request(url, {
      method,
      headers,
      body: Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>,
      duplex: "half",
    } as RequestInit);
  }

  const body = await readRawBody(req, bodyLimit);
  return new Request(url, { method, headers, body });
}

function toNodeHeaders(headers: Headers): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  const setCookie = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  if (setCookie.length > 0) result["set-cookie"] = setCookie;
  for (const [key, value] of headers) {
    if (key === "set-cookie") continue;
    result[key] = value;
  }
  return result;
}

async function writeWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.writeHead(response.status, toNodeHeaders(response.headers));

  if (!response.body) {
    res.end();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const nodeStream = Readable.fromWeb(response.body as any);
    nodeStream.on("error", reject);
    res.on("finish", resolve);
    nodeStream.pipe(res);
  });
}

export interface RhythmNodeHandlerOptions {
  /**
   * Maximum request body size in bytes, enforced by eagerly buffering the body
   * before the handler runs. Defaults to 1mb, same as raw-body/koa-bodyparser.
   *
   * Pass `false` to opt out of buffering entirely: ctx.request's body becomes a
   * live stream over the raw connection, with no size limit and no automatic
   * drain if the handler doesn't read it (see the adapter's README for the
   * keep-alive caveat that reintroduces). Use this for uploads or proxying,
   * where materializing the whole body in memory isn't acceptable.
   */
  bodyLimit?: number | false;
}

export function toNodeHandler<TContext extends RhythmHttpContext, TProviders extends object = {}>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
  options: RhythmNodeHandlerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const run = app.callback();
  const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const request = await toWebRequest(req, bodyLimit);
      const ctx = await run({ request, response: new RhythmResponse() });
      await writeWebResponse(toResponse(ctx.response), res);
    } catch (err) {
      if (!(err instanceof RhythmBodyTooLargeError)) console.error(err);
      if (!res.headersSent) {
        const status = err instanceof RhythmBodyTooLargeError ? 413 : 500;
        const message = err instanceof RhythmBodyTooLargeError ? err.message : "Internal Server Error";
        const headers: Record<string, string> = { "content-type": "text/plain; charset=utf-8" };
        if (err instanceof RhythmBodyTooLargeError) headers.connection = "close";
        res.writeHead(status, headers);
        res.end(message);
      } else {
        res.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    }
  };
}
