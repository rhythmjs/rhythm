import type { Rhythm } from "@rhythmjs/rhythm";
import { createFetchAdapter, type AdapterOptions } from "./base";
import type { RhythmHttpContext } from "../context";

export type { AdapterOptions };

interface FetchEventLike {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}

const fetchHandle = createFetchAdapter();

export function handle<TContext extends RhythmHttpContext, TProviders extends object = {}>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
  options: AdapterOptions = {},
): (event: FetchEventLike) => void {
  const handler = fetchHandle(app, options);
  return (event: FetchEventLike): void => {
    event.respondWith(handler(event.request));
  };
}
