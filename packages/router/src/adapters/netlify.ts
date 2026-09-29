import type { Rhythm } from "@rhythmjs/rhythm";
import { toFetchHandler } from "../fetch";
import type { RhythmHttpContext } from "../context";

export function handle<TContext extends RhythmHttpContext, TProviders extends object = {}>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
): (request: Request, context?: unknown) => Promise<Response> {
  const handler = toFetchHandler(app);
  return (request: Request, context?: unknown): Promise<Response> => {
    if (context !== undefined) {
      Object.defineProperty(request, "runtime", {
        value: { name: "netlify", netlify: { context } },
        configurable: true,
      });
    }
    return handler(request);
  };
}
