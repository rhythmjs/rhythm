import { Rhythm, type Mountable } from "@rhythmjs/rhythm";
import { RhythmResponse, STATUS_TEXT, createHttpContext, toResponse, type RhythmHttpContext } from "./context";

function isUntouched(response: RhythmResponse): boolean {
  return (
    response.status === 200 &&
    response.statusText === undefined &&
    response.body === null &&
    [...response.headers].length === 0
  );
}

export function toFetchHandler<I extends object = any>(
  app: Mountable<I> & (RhythmHttpContext extends I ? unknown : never),
): <WebSocketData>(request: Request, server?: Bun.Server<WebSocketData>) => Promise<Response> {
  const run = app.callback();
  return async (request, server) => {
    const base = createHttpContext(request, server);
    const result = (await run(base)) as Partial<RhythmHttpContext> | undefined;
    const response = result?.response ?? base.response;
    if (isUntouched(response)) {
      const fallback = new RhythmResponse();
      fallback.status = 404;
      fallback.headers.set("content-type", "text/plain; charset=utf-8");
      fallback.body = STATUS_TEXT[404]!;
      return toResponse(fallback);
    }
    return toResponse(response);
  };
}

function applyResponse(ctx: RhythmHttpContext, response: Response): void {
  ctx.response.status = response.status;
  ctx.response.statusText = response.statusText;
  for (const [name, value] of response.headers) {
    if (name === "set-cookie") ctx.response.headers.append(name, value);
    else ctx.response.headers.set(name, value);
  }
  ctx.response.body = response.body;
}

export function fromFetch(handler: (request: Request) => Response | Promise<Response>) {
  return new Rhythm<{}, RhythmHttpContext>({ name: "fetch" }).use(async (ctx) => {
    applyResponse(ctx, await handler(ctx.request));
  });
}

function declaredStatus(error: unknown): number | undefined {
  const { status, statusCode } = (error ?? {}) as { status?: number; statusCode?: number };
  const declared = status ?? statusCode;
  return Number.isInteger(declared) && declared! >= 400 && declared! <= 599 ? declared : undefined;
}

function rootCause(error: unknown): unknown {
  for (let current = error, depth = 0; depth < 16; depth++) {
    if (declaredStatus(current) !== undefined) return current;
    const cause = (current as { cause?: unknown } | null | undefined)?.cause;
    if (cause === undefined) return current;
    current = cause;
  }
  return error;
}

export function errorToResponse(error: unknown): Response {
  const source = rootCause(error);
  const status = declaredStatus(source) ?? 500;
  if (status >= 500) console.error(error);
  const expose = status < 500 && (source as { expose?: boolean }).expose !== false;
  const message = expose
    ? source instanceof Error
      ? source.message
      : String(source)
    : status >= 500
      ? "Internal Server Error"
      : (STATUS_TEXT[status] ?? `Error ${status}`);
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
