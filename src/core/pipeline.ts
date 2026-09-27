export type DeepReadonly<T> = T extends (...args: any[]) => any
  ? T
  : T extends ReadonlyArray<infer U>
    ? readonly DeepReadonly<U>[]
    : T extends Map<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends Set<infer U>
        ? ReadonlySet<DeepReadonly<U>>
        : T extends object
          ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
          : T;

export type NextFn<TContext extends object> = {
  (): Promise<DeepReadonly<TContext>>;
  <TExtra extends object>(extra: TExtra): Promise<DeepReadonly<TContext & TExtra>>;
};

export type Middleware<TContext extends object> = (
  ctx: DeepReadonly<TContext>,
  next: NextFn<TContext>,
) => Promise<void> | void;

export function compose<TContext extends object>(middleware: Middleware<TContext>[]) {
  if (!Array.isArray(middleware)) throw new TypeError("Middleware stack must be an array!");
  for (const fn of middleware) {
    if (typeof fn !== "function") throw new TypeError("Middleware must be composed of functions!");
  }

  return function (context: TContext, next?: NextFn<TContext>): Promise<TContext> {
    let index = -1;

    return dispatch(0);

    function dispatch(i: number): Promise<TContext> {
      if (i <= index) return Promise.reject(new Error("next() called multiple times"));
      index = i;

      const fn = i === middleware.length ? next : middleware[i];
      if (!fn) return Promise.resolve(context);

      const dispatchNext = ((extra?: object) => {
        if (extra) Object.assign(context, extra);
        return dispatch(i + 1);
      }) as NextFn<TContext>;

      try {
        const call = fn as (ctx: TContext, next: NextFn<TContext>) => Promise<void> | void;
        return Promise.resolve(call(context, dispatchNext)).then(() => context);
      } catch (err) {
        return Promise.reject(err);
      }
    }
  };
}

type ProviderEntry = {
  factory: (deps: any) => unknown | Promise<unknown>;
  dispose?: (value: any) => void | Promise<void>;
  resolved?: unknown;
};

export class Pipeline<
  TInput extends object = {},
  TContext extends object = TInput,
  TProviders extends object = {},
> {
  #middleware: Middleware<any>[] = [];
  #name: string;
  #providers: ProviderEntry[] = [];
  #setupPromise: Promise<void> | null = null;
  #providedCache: Record<string, unknown> | null = null;
  #composed: ((context: TContext, next?: NextFn<TContext>) => Promise<TContext>) | null = null;
  #callbackFn: ((input: TInput) => Promise<TContext>) | null = null;

  constructor(name = "anonymous") {
    this.#name = name;
  }

  use<TExtra extends object = {}>(fn: Middleware<TContext>): Pipeline<TInput, TContext & TExtra, TProviders> {
    if (typeof fn !== "function") throw new TypeError("middleware must be a function!");
    this.#middleware.push(fn);
    this.#invalidateCallback();
    return this as unknown as Pipeline<TInput, TContext & TExtra, TProviders>;
  }

  provide<TValue extends object>(
    factory: (deps: DeepReadonly<TProviders>) => TValue | Promise<TValue>,
    dispose?: (value: TValue) => void | Promise<void>,
  ): Pipeline<TInput, TContext & TValue, TProviders & TValue> {
    this.#providers.push({ factory, dispose });
    return this as unknown as Pipeline<TInput, TContext & TValue, TProviders & TValue>;
  }

  register<TRegInput extends object, TRegContext extends object, TExported extends object = {}>(
    other: Pipeline<TRegInput, TRegContext, any> & (TContext extends TRegInput ? unknown : never),
    exportValue?: (result: DeepReadonly<TRegContext>) => TExported,
  ): Pipeline<TInput, TContext & TExported, TProviders> {
    const module = other as Pipeline<TRegInput, TRegContext, any>;
    this.#providers.push({
      factory: async () => {
        await module.setup();
        return {};
      },
      dispose: () => module.teardown(),
    });
    this.#middleware.push(async (ctx, next) => {
      let result: TRegContext;
      try {
        result = await module.run(ctx as unknown as TRegInput);
      } catch (cause) {
        throw new Error(`registered module "${module.#name}" failed`, { cause });
      }
      await next(exportValue ? exportValue(result as DeepReadonly<TRegContext>) : ({} as TExported));
    });
    this.#invalidateCallback();
    return this as unknown as Pipeline<TInput, TContext & TExported, TProviders>;
  }

  #invalidateCallback(): void {
    this.#composed = null;
    this.#callbackFn = null;
  }

  setup(): Promise<void> {
    if (!this.#setupPromise) {
      this.#setupPromise = this.#resolveProviders().catch((err) => {
        this.#setupPromise = null;
        throw err;
      });
    }
    return this.#setupPromise;
  }

  async #resolveProviders(): Promise<void> {
    const resolved: Record<string, unknown> = {};
    for (const entry of this.#providers) {
      entry.resolved = await entry.factory(resolved);
      Object.assign(resolved, entry.resolved as object);
    }
    this.#providedCache = resolved;
  }

  async teardown(): Promise<void> {
    for (const entry of [...this.#providers].reverse()) {
      await entry.dispose?.(entry.resolved);
    }
  }

  callback(): (input: TInput) => Promise<TContext> {
    if (!this.#callbackFn) {
      if (!this.#composed) this.#composed = compose<TContext>(this.#middleware);
      const fn = this.#composed;
      this.#callbackFn = async (input: TInput) => {
        await this.setup();
        return fn({ ...(this.#providedCache as Record<string, unknown>), ...input } as unknown as TContext);
      };
    }
    return this.#callbackFn;
  }

  run(input: TInput): Promise<TContext> {
    return this.callback()(input);
  }
}
