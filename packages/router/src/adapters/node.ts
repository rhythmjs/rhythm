import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { Buffer } from "node:buffer";
import type { Rhythm } from "@rhythmjs/rhythm";
import {
  createHttpContext,
  toResponse,
  type RhythmHttpContext,
  type RhythmResponse,
} from "./context";

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

  // A pair list lets the Request constructor build its Headers in one native
  // call instead of one .set() per header.
  const headers: [string, string][] = [];
  for (const key in req.headers) {
    const value = req.headers[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.push([key, entry]);
    } else {
      headers.push([key, value]);
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

// String and byte bodies — the overwhelmingly common case — are written
// straight to the socket. Routing them through a web Response would wrap
// every payload in a ReadableStream and pay a full stream lifecycle per
// request, which roughly halves throughput.
function writeDirectResponse(response: RhythmResponse, res: ServerResponse): void {
  const { body, status } = response;
  const headers = toNodeHeaders(response.headers);

  let payload: string | Buffer | undefined;
  if (typeof body === "string") payload = body;
  else if (body instanceof Uint8Array)
    payload = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  else if (body instanceof ArrayBuffer) payload = Buffer.from(body);

  if (!("content-length" in headers) && status !== 204 && status !== 304) {
    headers["content-length"] =
      payload === undefined
        ? "0"
        : String(typeof payload === "string" ? Buffer.byteLength(payload) : payload.byteLength);
  }

  if (response.statusText !== undefined) res.writeHead(status, response.statusText, headers);
  else res.writeHead(status, headers);
  res.end(payload);
}

function hasDirectBody(body: RhythmResponse["body"]): boolean {
  return (
    body === null ||
    typeof body === "string" ||
    body instanceof Uint8Array ||
    body instanceof ArrayBuffer
  );
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
      const ctx = await run(createHttpContext(request));
      if (hasDirectBody(ctx.response.body)) {
        writeDirectResponse(ctx.response, res);
      } else {
        await writeWebResponse(toResponse(ctx.response), res);
      }
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
