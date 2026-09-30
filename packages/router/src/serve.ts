import type { Rhythm } from "@rhythmjs/rhythm";
import { toFetchHandler } from "./fetch";
import type { RhythmHttpContext } from "./context";
import { staticMiddleware, type StaticMiddlewareOptions } from "./static";

export type { StaticMiddlewareOptions };

export type Server = Bun.Server<unknown>;

export type ErrorHandler = (error: unknown) => Response | Promise<Response>;

export type ServeMiddleware = (request: Request, next: () => Promise<Response>) => Response | Promise<Response>;

export type UpgradeHandler = (
  request: Request,
  server: Server,
) => Response | undefined | null | Promise<Response | undefined> | null;

export interface RhythmServeOptions {
  port?: number;
  hostname?: string;
  unix?: string;
  reusePort?: boolean;
  idleTimeout?: number;
  development?: boolean;
  maxRequestBodySize?: number;
  tls?: Bun.TLSOptions;
  error?: ErrorHandler;
  middleware?: ServeMiddleware[];
  static?: StaticMiddlewareOptions | StaticMiddlewareOptions[];
  /** Bun websocket behavior; pair with `upgrade` to accept connections. */
  websocket?: Bun.WebSocketHandler<never>;
  /**
   * Called for websocket upgrade requests — `RhythmWs.upgrade` fits directly.
   * A Response rejects, undefined means `server.upgrade()` succeeded, and
   * null falls through to the HTTP app.
   */
  upgrade?: UpgradeHandler;
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
  const {
    static: staticOptions,
    middleware = [],
    error = errorToResponse,
    websocket,
    upgrade,
    ...bunOptions
  } = options;
  const assets = staticOptions === undefined ? [] : [staticOptions].flat().map(staticMiddleware);
  const chain = [...middleware, ...assets];
  const handler = toFetchHandler(app);

  const dispatch = (request: Request): Promise<Response> => {
    let index = -1;
    const next = async (step: number): Promise<Response> => {
      if (step <= index) throw new Error("next() called multiple times");
      index = step;
      return step < chain.length ? chain[step]!(request, () => next(step + 1)) : handler(request);
    };
    return next(0);
  };

  return Bun.serve({
    ...bunOptions,
    ...(websocket === undefined ? {} : { websocket }),
    async fetch(request: Request, server: Server): Promise<Response | undefined> {
      try {
        // The client address, resolved lazily; middlewares key rate limits
        // and x-forwarded-for chains off `request.ip`.
        Object.defineProperty(request, "ip", {
          configurable: true,
          get: () => server.requestIP(request)?.address,
        });
        if (upgrade !== undefined && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
          const result = await upgrade(request, server);
          if (result !== null) return result;
        }
        return await dispatch(request);
      } catch (thrown) {
        return error(thrown);
      }
    },
  } as Parameters<typeof Bun.serve>[0]);
}
