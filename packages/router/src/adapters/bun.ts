import type { Rhythm } from "@rhythmjs/rhythm";
import { RhythmResponse, toResponse, type RhythmHttpContext } from "./context";

export function toFetchHandler<TContext extends RhythmHttpContext, TProviders extends object = {}>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
): (request: Request) => Promise<Response> {
  const run = app.callback();
  return async (request: Request): Promise<Response> => {
    const ctx = await run({ request, response: new RhythmResponse() });
    return toResponse(ctx.response);
  };
}
