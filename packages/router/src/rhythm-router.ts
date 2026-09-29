import { compose } from "@rhythmjs/rhythm/compose";
import type { DeriveMiddleware, Middleware, NextFn } from "@rhythmjs/rhythm/types";
import { createNode, insertRoute, joinPath, lookupRoute, type TreeNode } from "./radix-tree";
import type { RhythmHttpContext } from "./adapters/context";

export interface RhythmRouterContext {
  readonly params: Readonly<Record<string, string>>;
}

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RhythmRouterOptions {
  prefix?: string;
}

type Entry =
  | { kind: "middleware"; fn: Middleware<any> }
  | { kind: "route"; method: HttpMethod; path: string; handlers: Middleware<any>[] };

type RouteHandler<TContext> = Middleware<TContext & RhythmRouterContext>;

export class RhythmRouter<TContext extends RhythmHttpContext = RhythmHttpContext> {
  #options: RhythmRouterOptions;
  #entries: Entry[] = [];
  #composed: ((context: TContext, next?: NextFn<TContext>) => Promise<TContext>) | null = null;

  constructor(options: RhythmRouterOptions = {}) {
    this.#options = options;
  }

  get #prefix(): string {
    return this.#options.prefix ?? "";
  }

  use(child: RhythmRouter<any>): this;
  use<TExtra extends object>(fn: DeriveMiddleware<TContext, TExtra>): RhythmRouter<TContext & TExtra>;
  use(fn: Middleware<TContext>): this;
  use(arg: Middleware<TContext> | RhythmRouter<any>): RhythmRouter<any> {
    if (arg instanceof RhythmRouter) {
      for (const entry of arg.#entries) {
        this.#entries.push(entry.kind === "route" ? { ...entry, path: joinPath(this.#prefix, entry.path) } : entry);
      }
    } else {
      if (typeof arg !== "function") throw new TypeError("middleware must be a function!");
      this.#entries.push({ kind: "middleware", fn: arg });
    }
    this.#composed = null;
    return this;
  }

  #route(method: HttpMethod, path: string, handlers: Middleware<any>[]): this {
    this.#entries.push({ kind: "route", method, path: joinPath(this.#prefix, path), handlers });
    this.#composed = null;
    return this;
  }

  get(path: string, ...handlers: RouteHandler<TContext>[]): this {
    return this.#route("GET", path, handlers);
  }

  post(path: string, ...handlers: RouteHandler<TContext>[]): this {
    return this.#route("POST", path, handlers);
  }

  put(path: string, ...handlers: RouteHandler<TContext>[]): this {
    return this.#route("PUT", path, handlers);
  }

  patch(path: string, ...handlers: RouteHandler<TContext>[]): this {
    return this.#route("PATCH", path, handlers);
  }

  delete(path: string, ...handlers: RouteHandler<TContext>[]): this {
    return this.#route("DELETE", path, handlers);
  }

  #compile(): (context: TContext, next?: NextFn<TContext>) => Promise<TContext> {
    if (this.#composed) return this.#composed;

    type RouteDispatch = (context: TContext & RhythmRouterContext, next?: NextFn<any>) => Promise<unknown>;

    const dispatchFor = (tree: TreeNode<HttpMethod, RouteDispatch>): Middleware<any> => {
      return async (ctx, next) => {
        const match = lookupRoute(tree, ctx.request.method, new URL(ctx.request.url).pathname);
        if (!match) {
          await next();
          return;
        }
        await match.payload({ ...ctx, params: match.params } as TContext & RhythmRouterContext, next);
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
      const tree = createNode<HttpMethod, RouteDispatch>();
      while (i < this.#entries.length) {
        const route = this.#entries[i]!;
        if (route.kind !== "route") break;
        insertRoute(tree, route.method, route.path, compose(route.handlers) as RouteDispatch);
        i++;
      }
      stack.push(dispatchFor(tree));
    }

    this.#composed = compose<TContext>(stack);
    return this.#composed;
  }

  routes(): Middleware<TContext> {
    return async (ctx, next) => {
      await this.#compile()(ctx as unknown as TContext, next);
    };
  }
}
