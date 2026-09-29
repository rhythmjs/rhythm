import type { Rhythm } from "@rhythmjs/rhythm";
import { toFetchHandler } from "../fetch";
import type { RhythmHttpContext } from "../context";

interface FetchEventLike {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}

export function handle<TContext extends RhythmHttpContext, TProviders extends object = {}>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
): (event: FetchEventLike) => void {
  const handler = toFetchHandler(app);
  return (event: FetchEventLike): void => {
    event.respondWith(handler(event.request));
  };
}
