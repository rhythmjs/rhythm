import { compose } from "@rhythmjs/rhythm/compose";
import { sourceOf, withSource } from "@rhythmjs/rhythm/source";
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
  if (path === "/" || path === "") return prefix;
  const trimmedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedPrefix}${normalizedPath}`;
}

function mountedRoutes(router: RhythmRouter<any, any>, tree: RouterContext<any>, seen = new Set<object>()): void {
  if (seen.has(router)) return;
  seen.add(router);
  for (const entry of router.entries) {
    if (entry.kind === "route") addRoute(tree, entry.method, entry.path, true);
    else {
      const child = sourceOf(entry.fn);
      if (child instanceof RhythmRouter) mountedRoutes(child, tree, seen);
    }
  }
}

export class RhythmRouter<
  TContext extends RhythmHttpContext = RhythmHttpContext,
  TInput extends RhythmHttpContext = TContext,
> {
  #options: RhythmRouterOptions;
  #entries: Entry[] = [];

  constructor(options: RhythmRouterOptions = {}) {
    this.#options = options;
  }

  get #prefixPath(): string {
    return this.#options.prefix ?? "";
  }

  get entries(): readonly RouterEntry[] {
    return [...this.#entries];
  }

  use<TExtra extends object>(fn: DeriveMiddleware<TContext, TExtra>): RhythmRouter<TContext & TExtra, TInput>;
  use(fn: Middleware<TContext>): this;
  use(fn: Middleware<TContext>): any {
    if (typeof fn !== "function") throw new TypeError("middleware must be a function!");
    this.#entries.push({ kind: "middleware", fn });
    return this;
  }

  #route(method: HttpMethod, path: string, handlers: Middleware<any>[]): this {
    this.#entries.push({ kind: "route", method, path: joinPath(this.#prefixPath, path), handlers });
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

    const trees: RouterContext<any>[] = [];
    const reaches = (ctx: { request: Request }, from: number): boolean => {
      const method = ctx.request.method;
      const pathname = new URL(ctx.request.url).pathname;
      for (let t = from; t < trees.length; t++) if (findRoute(trees[t]!, method, pathname)) return true;
      return false;
    };

    const stack: Middleware<any>[] = [];
    let i = 0;
    while (i < this.#entries.length) {
      const entry = this.#entries[i]!;
      if (entry.kind === "middleware") {
        const { fn } = entry;
        const source = sourceOf(fn);
        if (source) {
          // A mounted router gates its own middleware, but its routes still count as "routes after" the
          // middleware registered before it, so those run for the child's requests too.
          if (source instanceof RhythmRouter) {
            const tree = createRouter<true>();
            mountedRoutes(source, tree);
            trees.push(tree);
          }
          stack.push(fn);
        } else {
          const from = trees.length;
          stack.push((ctx, next) => (reaches(ctx, from) ? fn(ctx, next) : next()));
        }
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
      trees.push(tree);
      stack.push(dispatchFor(tree));
    }

    return compose<TContext>(stack);
  }

  middleware(): Middleware<TInput> {
    const fn = this.#compile();
    return withSource(async (ctx, next) => {
      await fn(ctx as unknown as TContext, next as never);
    }, this);
  }
}
