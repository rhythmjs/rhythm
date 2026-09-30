import type { ErrorHandler, ServerRuntimeContext } from "srvx";
import type { Rhythm } from "@rhythmjs/rhythm";
import { toFetchHandler } from "../fetch";
import { errorToResponse } from "../serve";
import type { RhythmHttpContext } from "../context";

export interface AdapterOptions {
  onError?: ErrorHandler;
}

export type FetchAdapter<TExtra extends unknown[] = []> = <
  TContext extends RhythmHttpContext,
  TProviders extends object = {},
>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
  options?: AdapterOptions,
) => (request: Request, ...extra: TExtra) => Promise<Response>;

export function setRuntime(request: Request, runtime: ServerRuntimeContext): void {
  Object.defineProperty(request, "runtime", { value: runtime, configurable: true });
}

export function createFetchAdapter<TExtra extends unknown[] = []>(
  enrich?: (request: Request, ...extra: TExtra) => void,
): FetchAdapter<TExtra> {
  return (app, options = {}) => {
    const handler = toFetchHandler(app);
    const onError = options.onError ?? errorToResponse;
    return async (request: Request, ...extra: TExtra): Promise<Response> => {
      try {
        enrich?.(request, ...extra);
        return await handler(request);
      } catch (error) {
        return onError(error);
      }
    };
  };
}
