import type { Rhythm } from "@rhythmjs/rhythm";
import { toFetchHandler } from "../fetch";
import type { RhythmHttpContext } from "../context";

export function handle<TContext extends RhythmHttpContext, TProviders extends object = {}>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
): (request: Request, env?: unknown, context?: unknown) => Promise<Response> {
  const handler = toFetchHandler(app);
  return (request: Request, env?: unknown, context?: unknown): Promise<Response> => {
    if (env !== undefined || context !== undefined) {
      Object.defineProperty(request, "runtime", {
        value: { name: "cloudflare", cloudflare: { env, context } },
        configurable: true,
      });
    }
    return handler(request);
  };
}
