import type { Rhythm } from "@rhythmjs/rhythm";
import { toFetchHandler } from "../fetch";
import type { RhythmHttpContext } from "../context";

export function handle<TContext extends RhythmHttpContext, TProviders extends object = {}>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
): (request: Request) => Promise<Response> {
  return toFetchHandler(app);
}
