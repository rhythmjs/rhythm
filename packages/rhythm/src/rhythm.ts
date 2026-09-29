import { compose } from "./compose";
import type { DeepReadonly, Middleware, OmitHashKeys } from "./types";

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

export class Rhythm<TInput extends object = {}, TContext extends object = TInput, TProviders extends object = {}> {
  #middleware: Middleware<any>[] = [];
  #options: RhythmOptions;
  #providers: ProviderEntry[] = [];
  #setupPromise: Promise<void> | null = null;

  constructor(options: RhythmOptions = {}) {
    this.#options = options;
  }

  use<TExtra extends object = {}>(fn: Middleware<TContext>): Rhythm<TInput, TContext & TExtra, TProviders> {
    if (typeof fn !== "function") throw new TypeError("middleware must be a function!");
    this.#middleware.push(fn);
    return this as unknown as Rhythm<TInput, TContext & TExtra, TProviders>;
  }

  provide<TValue extends object>(
    factory: (deps: DeepReadonly<TProviders>) => TValue | Promise<TValue>,
    dispose?: (value: TValue) => void | Promise<void>,
  ): Rhythm<TInput, TContext & OmitHashKeys<TValue>, TProviders & OmitHashKeys<TValue>> {
    const entry: ProviderEntry = { factory, dispose };
    this.#providers.push(entry);
    this.#middleware.push(async (ctx, next) => {
      const exported: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(entry.resolved as object)) {
        if (!key.startsWith("#")) exported[key] = value;
      }
      await next(exported);
    });
    return this as unknown as Rhythm<TInput, TContext & OmitHashKeys<TValue>, TProviders & OmitHashKeys<TValue>>;
  }

  register<TRegInput extends object, TRegContext extends object, TExported extends object = {}>(
    other: Rhythm<TRegInput, TRegContext, any> & (TContext extends TRegInput ? unknown : never),
    exportValue?: (result: DeepReadonly<TRegContext>) => TExported,
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
      await next(exportValue ? exportValue(result as DeepReadonly<TRegContext>) : ({} as TExported));
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
      for (const [key, value] of Object.entries(entry.resolved as object)) {
        if (!key.startsWith("#")) resolved[key] = value;
      }
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
