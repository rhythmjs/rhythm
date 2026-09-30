import { compose } from "@rhythmjs/rhythm/compose";
import type { DeriveMiddleware, Middleware, NextFn } from "@rhythmjs/rhythm/types";
import { addRoute, createRouter, findRoute, type RouterContext } from "rou3";
import type { RhythmHttpContext } from "./context";

export interface RhythmRouterContext {
  readonly params: Readonly<Record<string, string>>;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RhythmRouterOptions {
  prefix?: string;
}

export type RouterEntry =
  | { readonly kind: "middleware"; readonly fn: Middleware<any> }
  | {
      readonly kind: "route";
      readonly method: HttpMethod;
      readonly path: string;
      readonly handlers: readonly Middleware<any>[];
    };

type Entry =
  | { kind: "middleware"; fn: Middleware<any> }
  | { kind: "route"; method: HttpMethod; path: string; handlers: Middleware<any>[] };

type RouteHandler<TContext> = Middleware<TContext & RhythmRouterContext>;

export function joinPath(prefix: string, path: string): string {
  if (!prefix) return path;
  const trimmedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedPrefix}${normalizedPath}`;
}

export class RhythmRouter<TContext extends RhythmHttpContext = RhythmHttpContext> {
  #options: RhythmRouterOptions;
  #entries: Entry[] = [];

  constructor(options: RhythmRouterOptions = {}) {
    this.#options = options;
  }

  get #prefix(): string {
    return this.#options.prefix ?? "";
  }

  get entries(): readonly RouterEntry[] {
    return [...this.#entries];
  }

  use<TExtra extends object>(fn: DeriveMiddleware<TContext, TExtra>): RhythmRouter<TContext & TExtra>;
  use(fn: Middleware<TContext>): this;
  use(fn: Middleware<TContext>): any {
    if (typeof fn !== "function") throw new TypeError("middleware must be a function!");
    this.#entries.push({ kind: "middleware", fn });
    return this;
  }

  #route(method: HttpMethod, path: string, handlers: Middleware<any>[]): this {
    this.#entries.push({ kind: "route", method, path: joinPath(this.#prefix, path), handlers });
    return this;
  }

  get<TExtra extends object>(
    path: string,
    middleware: DeriveMiddleware<TContext & RhythmRouterContext, TExtra>,
    ...handlers: RouteHandler<TContext & TExtra>[]
  ): this;
  get(path: string, ...handlers: RouteHandler<TContext>[]): this;
  get(path: string, ...handlers: Middleware<any>[]): this {
    return this.#route("GET", path, handlers);
  }

  post<TExtra extends object>(
    path: string,
    middleware: DeriveMiddleware<TContext & RhythmRouterContext, TExtra>,
    ...handlers: RouteHandler<TContext & TExtra>[]
  ): this;
  post(path: string, ...handlers: RouteHandler<TContext>[]): this;
  post(path: string, ...handlers: Middleware<any>[]): this {
    return this.#route("POST", path, handlers);
  }

  put<TExtra extends object>(
    path: string,
    middleware: DeriveMiddleware<TContext & RhythmRouterContext, TExtra>,
    ...handlers: RouteHandler<TContext & TExtra>[]
  ): this;
  put(path: string, ...handlers: RouteHandler<TContext>[]): this;
  put(path: string, ...handlers: Middleware<any>[]): this {
    return this.#route("PUT", path, handlers);
  }

  patch<TExtra extends object>(
    path: string,
    middleware: DeriveMiddleware<TContext & RhythmRouterContext, TExtra>,
    ...handlers: RouteHandler<TContext & TExtra>[]
  ): this;
  patch(path: string, ...handlers: RouteHandler<TContext>[]): this;
  patch(path: string, ...handlers: Middleware<any>[]): this {
    return this.#route("PATCH", path, handlers);
  }

  delete<TExtra extends object>(
    path: string,
    middleware: DeriveMiddleware<TContext & RhythmRouterContext, TExtra>,
    ...handlers: RouteHandler<TContext & TExtra>[]
  ): this;
  delete(path: string, ...handlers: RouteHandler<TContext>[]): this;
  delete(path: string, ...handlers: Middleware<any>[]): this {
    return this.#route("DELETE", path, handlers);
  }

  #compile(): (context: TContext, next?: NextFn<TContext>) => Promise<TContext> {
    type RouteDispatch = (context: TContext & RhythmRouterContext, next?: NextFn<any>) => Promise<unknown>;

    const dispatchFor = (tree: RouterContext<RouteDispatch>): Middleware<any> => {
      return async (ctx, next) => {
        const match = findRoute(tree, ctx.request.method, new URL(ctx.request.url).pathname);
        if (!match) {
          await next();
          return;
        }
        await match.data({ ...ctx, params: match.params ?? {} } as TContext & RhythmRouterContext, next);
      };
    };

    const stack: Middleware<any>[] = [];
    let i = 0;
    while (i < this.#entries.length) {
      const entry = this.#entries[i]!;
      if (entry.kind === "middleware") {
        stack.push(entry.fn);
        i++;
        continue;
      }
      const tree = createRouter<RouteDispatch>();
      while (i < this.#entries.length) {
        const route = this.#entries[i]!;
        if (route.kind !== "route") break;
        addRoute(tree, route.method, route.path, compose(route.handlers) as RouteDispatch);
        i++;
      }
      stack.push(dispatchFor(tree));
    }

    return compose<TContext>(stack);
  }

  middleware(): Middleware<TContext> {
    const fn = this.#compile();
    return async (ctx, next) => {
      await fn(ctx as unknown as TContext, next);
    };
  }
}
