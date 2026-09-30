import {
  serve as srvxServe,
  type ErrorHandler,
  type Server,
  type ServerMiddleware,
  type ServerOptions,
  type ServerPlugin,
} from "srvx";
import { staticMiddleware, type StaticMiddlewareOptions } from "srvx/static";
import type { Rhythm } from "@rhythmjs/rhythm";
import { toFetchHandler } from "./fetch";
import type { RhythmHttpContext } from "./context";

export type { ErrorHandler, Server, ServerMiddleware, ServerPlugin, StaticMiddlewareOptions };

export interface RhythmServeOptions extends Omit<ServerOptions, "fetch"> {
  static?: StaticMiddlewareOptions | StaticMiddlewareOptions[];
}

export const errorToResponse: ErrorHandler = (error) => {
  const status = (error as { status?: number }).status ?? (error as { statusCode?: number }).statusCode ?? 500;
  const message = status >= 500 ? "Internal Server Error" : error instanceof Error ? error.message : String(error);
  if (status >= 500) console.error(error);
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
};

export function serve<TContext extends RhythmHttpContext, TProviders extends object = {}>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
  options: RhythmServeOptions = {},
): Server {
  const { static: staticOptions, ...serverOptions } = options;
  const assets = staticOptions === undefined ? [] : [staticOptions].flat().map(staticMiddleware);
  return srvxServe({
    error: errorToResponse,
    ...serverOptions,
    middleware: [...(serverOptions.middleware ?? []), ...assets],
    fetch: toFetchHandler(app),
  });
}
