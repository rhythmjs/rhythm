import { addRoute, createRouter, findRoute, type InferRouteParams } from "rou3";
import {
  Pipeline,
  compose,
  type ExtensionMiddleware,
  type Middleware,
  type Next,
  type PipelineOptions,
} from "@rhythmjs/rhythm";
import type { RhythmHttpContext } from "./context";

export type RouterContext<T extends object> = T & RhythmHttpContext;

export type UseContext<T extends object> = RouterContext<T> & { readonly params: Record<string, string> };

export type RouteContext<T extends object, P extends string> = RouterContext<T> & {
  params: InferRouteParams<P>;
};

export type RouteHandler<T extends object, P extends string> = (
  ctx: RouteContext<T, P>,
  next: Next,
) => unknown | Promise<unknown>;

export type RouteHandlers<T extends object, P extends string> = [RouteHandler<T, P>, ...RouteHandler<T, P>[]];

type Route<T extends object> = (ctx: RouterContext<T>) => Promise<void>;

function decodeParams(params: Record<string, string> | undefined) {
  const decoded: Record<string, string> = {};
  try {
    for (const [key, value] of Object.entries(params ?? {})) {
      decoded[key] = decodeURIComponent(value);
    }
  } catch {
    return undefined;
  }
  return decoded;
}

export class RhythmRouter<I extends object = {}, D extends object = {}> extends Pipeline<UseContext<I & D>> {
  declare readonly "~input"?: I;

  #routes = createRouter<Route<I & D>>();

  constructor(options?: PipelineOptions) {
    super({ type: "router", ...options });
  }

  override use<U extends object>(middleware: ExtensionMiddleware<UseContext<I & D>, U>): RhythmRouter<I, D & U>;
  override use(middleware: Middleware<UseContext<I & D>>): this;
  override use(middleware: Middleware<UseContext<I & D>>) {
    return super.use(middleware);
  }

  get<P extends string, U extends object>(
    path: P,
    middleware: ExtensionMiddleware<RouteContext<I & D, P>, U>,
    ...handlers: RouteHandler<I & D & U, P>[]
  ): this;
  get<P extends string>(path: P, ...handlers: RouteHandlers<I & D, P>): this;
  get(path: string, ...handlers: Middleware<any>[]): this {
    return this.#route("GET", path, handlers);
  }

  post<P extends string, U extends object>(
    path: P,
    middleware: ExtensionMiddleware<RouteContext<I & D, P>, U>,
    ...handlers: RouteHandler<I & D & U, P>[]
  ): this;
  post<P extends string>(path: P, ...handlers: RouteHandlers<I & D, P>): this;
  post(path: string, ...handlers: Middleware<any>[]): this {
    return this.#route("POST", path, handlers);
  }

  put<P extends string, U extends object>(
    path: P,
    middleware: ExtensionMiddleware<RouteContext<I & D, P>, U>,
    ...handlers: RouteHandler<I & D & U, P>[]
  ): this;
  put<P extends string>(path: P, ...handlers: RouteHandlers<I & D, P>): this;
  put(path: string, ...handlers: Middleware<any>[]): this {
    return this.#route("PUT", path, handlers);
  }

  patch<P extends string, U extends object>(
    path: P,
    middleware: ExtensionMiddleware<RouteContext<I & D, P>, U>,
    ...handlers: RouteHandler<I & D & U, P>[]
  ): this;
  patch<P extends string>(path: P, ...handlers: RouteHandlers<I & D, P>): this;
  patch(path: string, ...handlers: Middleware<any>[]): this {
    return this.#route("PATCH", path, handlers);
  }

  delete<P extends string, U extends object>(
    path: P,
    middleware: ExtensionMiddleware<RouteContext<I & D, P>, U>,
    ...handlers: RouteHandler<I & D & U, P>[]
  ): this;
  delete<P extends string>(path: P, ...handlers: RouteHandlers<I & D, P>): this;
  delete(path: string, ...handlers: Middleware<any>[]): this {
    return this.#route("DELETE", path, handlers);
  }

  override callback() {
    const run = this.chain();
    return async (input: RouterContext<I>) => {
      const ctx = input as RouterContext<I & D>;
      const match = this.#match(ctx);
      if (!match) return ctx;
      Object.assign(ctx, { params: match.params });
      await run(ctx as UseContext<I & D>, () => match.route(ctx));
      return ctx;
    };
  }

  #match(ctx: RouterContext<I & D>) {
    const found = findRoute(this.#routes, ctx.request.method, new URL(ctx.request.url).pathname);
    if (!found) return undefined;
    const params = decodeParams(found.params);
    if (!params) return undefined;
    return { route: found.data, params };
  }

  #route(method: string, path: string, handlers: Middleware<any>[]): this {
    const chain = compose(handlers as Middleware<RouterContext<I & D>>[]);
    addRoute(this.#routes, method, path, (ctx) => chain(ctx));
    return this;
  }
}
