import type { Rhythm } from "@rhythmjs/rhythm";
import { createHttpContext, STATUS_TEXT, type RhythmHttpContext } from "./context";

export function toFetchHandler<TContext extends RhythmHttpContext, TProviders extends object = {}>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
): (request: Request) => Promise<Response> {
  const run = app.callback();
  return async (request: Request): Promise<Response> => {
    const ctx = await run(createHttpContext(request));
    const response = ctx.response;
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export function errorToResponse(error: unknown): Response {
  const declared = (error as { status?: number }).status ?? (error as { statusCode?: number }).statusCode;
  const status = Number.isInteger(declared) && declared! >= 400 && declared! <= 599 ? declared! : 500;
  if (status >= 500) console.error(error);
  const expose = status < 500 && (error as { expose?: boolean }).expose !== false;
  const message = expose
    ? error instanceof Error
      ? error.message
      : String(error)
    : status >= 500
      ? "Internal Server Error"
      : (STATUS_TEXT[status] ?? `Error ${status}`);
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
