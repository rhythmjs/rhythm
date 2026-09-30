import type { Rhythm } from "@rhythmjs/rhythm";
import { createHttpContext, type RhythmHttpContext } from "./context";

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
  const status = (error as { status?: number }).status ?? (error as { statusCode?: number }).statusCode ?? 500;
  const message = status >= 500 ? "Internal Server Error" : error instanceof Error ? error.message : String(error);
  if (status >= 500) console.error(error);
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
