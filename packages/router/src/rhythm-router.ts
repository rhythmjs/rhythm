import { Rhythm, type DeepReadonly, type Middleware, type NextFn, type OmitHashKeys } from "@rhythmjs/rhythm";
import { createNode, insertRoute, joinPath, lookupRoute, type TreeNode } from "./radix-tree";
import type { RhythmHttpContext } from "./adapters/context";

export interface RhythmRouterContext {
  params: Record<string, string>;
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

export interface RhythmRouterOptions {
  name?: string;
  prefix?: string;
}

const RhythmRouterTag = Symbol("RhythmRouterTag");

type RouteEntry = {
  kind: "route";
  method: HttpMethod;
  path: string;
  handlers: Middleware<any>[];
};

type MiddlewareEntry = {
  kind: "middleware";
  fn: Middleware<any>;
};

type Entry = RouteEntry | MiddlewareEntry;

type TaggedMiddleware = Middleware<any> & { [RhythmRouterTag]?: RhythmRouter<any, any> };

export class RhythmRouter<
  TContext extends RhythmHttpContext = RhythmHttpContext,
  TProviders extends object = {},
> extends Rhythm<RhythmHttpContext, TContext, TProviders> {
  #prefix: string;
  #entries: Entry[] = [];
  #tree: TreeNode<HttpMethod> = createNode<HttpMethod>();
  #dispatchInstalled = false;

  constructor(options: RhythmRouterOptions = {}) {
    super({ name: options.name ?? "router", type: "controller" });
    this.#prefix = options.prefix ?? "";
  }

  override use<TExtra extends object = {}>(fn: Middleware<TContext>): RhythmRouter<TContext & TExtra, TProviders> {
    const nested = (fn as TaggedMiddleware)[RhythmRouterTag];
    if (nested) {
      for (const entry of nested.#entries) this.#mount(entry);
    } else {
      this.#entries.push({ kind: "middleware", fn });
      super.use(fn);
    }
    return this as unknown as RhythmRouter<TContext & TExtra, TProviders>;
  }

  override provide<TValue extends object>(
    factory: (deps: DeepReadonly<TProviders>) => TValue | Promise<TValue>,
    dispose?: (value: TValue) => void | Promise<void>,
  ): RhythmRouter<TContext & OmitHashKeys<TValue>, TProviders & OmitHashKeys<TValue>> {
    super.provide(factory, dispose);
    return this as unknown as RhythmRouter<TContext & OmitHashKeys<TValue>, TProviders & OmitHashKeys<TValue>>;
  }

  override register(): never {
    throw new Error("RhythmRouter is a controller and cannot register() other modules or controllers");
  }

  #mount(entry: Entry): void {
    if (entry.kind === "middleware") {
      this.#entries.push(entry);
      super.use(entry.fn);
      return;
    }
    this.#registerRoute(entry.method, joinPath(this.#prefix, entry.path), entry.handlers);
  }

  #registerRoute(method: HttpMethod, fullPath: string, handlers: Middleware<any>[]): void {
    this.#entries.push({ kind: "route", method, path: fullPath, handlers });
    insertRoute(this.#tree, method, fullPath, handlers);

    if (this.#dispatchInstalled) return;
    this.#dispatchInstalled = true;

    const tree = this.#tree;
    super.use(async (ctx, next) => {
      const match = lookupRoute(tree, ctx.request.method, new URL(ctx.request.url).pathname);
      if (!match) {
        await next();
        return;
      }
      await match.entry.dispatch(
        { ...ctx, params: match.params } as TContext & RhythmRouterContext,
        next as unknown as NextFn<TContext & RhythmRouterContext>,
      );
    });
  }

  #route(method: HttpMethod, path: string, handlers: Middleware<TContext & RhythmRouterContext>[]): this {
    this.#registerRoute(method, joinPath(this.#prefix, path), handlers);
    return this;
  }

  get(path: string, ...handlers: Middleware<TContext & RhythmRouterContext>[]): this {
    return this.#route("GET", path, handlers);
  }

  post(path: string, ...handlers: Middleware<TContext & RhythmRouterContext>[]): this {
    return this.#route("POST", path, handlers);
  }

  put(path: string, ...handlers: Middleware<TContext & RhythmRouterContext>[]): this {
    return this.#route("PUT", path, handlers);
  }

  patch(path: string, ...handlers: Middleware<TContext & RhythmRouterContext>[]): this {
    return this.#route("PATCH", path, handlers);
  }

  delete(path: string, ...handlers: Middleware<TContext & RhythmRouterContext>[]): this {
    return this.#route("DELETE", path, handlers);
  }

  routes(): Middleware<TContext> {
    const mw = this.middleware() as TaggedMiddleware;
    mw[RhythmRouterTag] = this;
    return mw;
  }
}
