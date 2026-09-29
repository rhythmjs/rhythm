import { compose } from "./compose";
import type { DeriveMiddleware, Middleware, OmitHashKeys } from "./types";

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

  constructor(options: RhythmOptions = {}) {
    this.#options = options;
  }

  use<TExtra extends object>(fn: DeriveMiddleware<TContext, TExtra>): Rhythm<TInput, TContext & TExtra, TProviders>;
  use(fn: Middleware<TContext>): this;
  use(fn: Middleware<TContext>): any {
    if (typeof fn !== "function") throw new TypeError("middleware must be a function!");
    this.#middleware.push(fn);
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
        const { type = "module", name = "anonymous" } = module.#options;
        throw new Error(`registered ${type} "${name}" failed`, { cause });
      }
      if (exportValue) Object.assign(ctx, exportValue(result));
      await next();
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
    return async (ctx, next) => {
      await this.setup();
      await fn(ctx as unknown as TContext, next);
    };
  }
}
