import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Rhythm } from "@rhythmjs/rhythm";
import { RhythmResponse, toResponse, type RhythmHttpContext } from "./context";

const DEFAULT_BODY_LIMIT = 1024 * 1024;

export class RhythmBodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`request body exceeds the ${limit} byte limit`);
    this.name = "RhythmBodyTooLargeError";
  }
}

function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let tooLarge = false;
    let settled = false;

    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > limit) {
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
