import { compose } from "./compose";
import { sourceOf, withSource } from "./source";
import type { DeriveMiddleware, Middleware, NextFn, OmitHashKeys } from "./types";

type ProviderEntry = {
  factory: (deps: any) => unknown;
  dispose?: (value: any) => void | Promise<void>;
  resolved?: unknown;
};

export interface RhythmOptions {
  name?: string;
  type?: string;
  [key: string]: unknown;
}

function publicEntries(value: object): Record<string, unknown> {
  const exported: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (!key.startsWith("#")) exported[key] = val;
  }
  return exported;
}

export function derive<TContext extends object, TExtra extends object>(
  fn: (ctx: TContext) => TExtra | Promise<TExtra>,
): DeriveMiddleware<TContext, OmitHashKeys<TExtra>> {
  if (typeof fn !== "function") throw new TypeError("derive factory must be a function!");
  const middleware: Middleware<TContext> = async (ctx, next) => {
    const value = await fn(ctx);
    Object.assign(ctx, publicEntries(value as object));
    await next();
  };
  return middleware as DeriveMiddleware<TContext, OmitHashKeys<TExtra>>;
}

export class Rhythm<TInput extends object = {}, TContext extends object = TInput, TProviders extends object = {}> {
  #middleware: Middleware<any>[] = [];
  #options: RhythmOptions;
  #providers: ProviderEntry[] = [];
  #setupPromise: Promise<void> | null = null;
  #sources: object[] = [];

  parent?: Rhythm<any, any, any>;

  constructor(options: RhythmOptions = {}) {
    this.#options = options;
  }

  get sources(): readonly object[] {
    return this.#sources.flatMap((source) => (source instanceof Rhythm ? source.sources : [source]));
  }

  #adopt(source: object | undefined): void {
    if (!source) return;
    if (source instanceof Rhythm) source.parent = this;
    this.#sources.push(source);
  }

  use<TExtra extends object>(fn: DeriveMiddleware<TContext, TExtra>): Rhythm<TInput, TContext & TExtra, TProviders>;
  use(fn: Middleware<TContext>): this;
  use(fn: Middleware<TContext>): any {
    if (typeof fn !== "function") throw new TypeError("middleware must be a function!");
    this.#middleware.push(fn);
    this.#adopt(sourceOf(fn));
    return this;
  }

  provide<TValue extends object>(
    factory: (deps: TProviders) => TValue | Promise<TValue>,
    dispose?: (value: TValue) => void | Promise<void>,
  ): Rhythm<TInput, TContext & OmitHashKeys<TValue>, TProviders & OmitHashKeys<TValue>> {
    const entry: ProviderEntry = { factory, dispose };
    this.#providers.push(entry);
    this.#middleware.push(async (ctx, next) => {
      Object.assign(ctx, publicEntries(entry.resolved as object));
      await next();
    });
    return this as unknown as Rhythm<TInput, TContext & OmitHashKeys<TValue>, TProviders & OmitHashKeys<TValue>>;
  }

  register<TRegInput extends object, TRegContext extends object, TExported extends object = {}>(
    other: Rhythm<TRegInput, TRegContext, any> & (TContext extends TRegInput ? unknown : never),
    exportValue?: (result: TRegContext) => TExported,
  ): Rhythm<TInput, TContext & TExported, TProviders> {
    const module = other as Rhythm<TRegInput, TRegContext, any>;
    this.#adopt(module);
    this.#providers.push({
      factory: async () => {
        await module.setup();
        return {};
      },
      dispose: () => module.teardown(),
    });
    let chain: ((context: TRegContext, next?: NextFn<TRegContext>) => Promise<TRegContext>) | undefined;
    this.#middleware.push(async (ctx, next) => {
      const inner = { ...ctx } as unknown as TRegContext;
      let downstream: { error: unknown } | undefined;
      try {
        await module.setup();
        await (chain ??= compose<TRegContext>([...module.#middleware]))(inner, async () => {
          try {
            if (exportValue) Object.assign(ctx, exportValue(inner));
            await next();
          } catch (error) {
            downstream = { error };
            throw error;
          }
          return inner;
        });
      } catch (cause) {
        if (downstream && downstream.error === cause) throw cause;
        const { type = "module", name = "anonymous" } = module.#options;
        throw new Error(`registered ${type} "${name}" failed`, { cause });
      }
    });
    return this as unknown as Rhythm<TInput, TContext & TExported, TProviders>;
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
      Object.assign(resolved, publicEntries(entry.resolved as object));
    }
  }

  async teardown(): Promise<void> {
    for (const entry of [...this.#providers].reverse()) {
      if (entry.resolved === undefined) continue;
      await entry.dispose?.(entry.resolved);
      entry.resolved = undefined;
    }
    this.#setupPromise = null;
  }

  callback(): (input: TInput) => Promise<TContext> {
    const fn = compose<TContext>([...this.#middleware]);
    return async (input: TInput) => {
      await this.setup();
      return fn({ ...input } as unknown as TContext);
    };
  }

  run(input: TInput): Promise<TContext> {
    return this.callback()(input);
  }

  middleware(): Middleware<TContext> {
    const fn = compose<TContext>([...this.#middleware]);
    return withSource(async (ctx, next) => {
      await this.setup();
      await fn(ctx as unknown as TContext, next);
    }, this);
  }
}
