import { Rhythm, compose, type DeepReadonly, type Middleware, type NextFn, type OmitHashKeys } from "../core/rhythm";
import type { RhythmCliContext } from "./adapters/context";
import { parseArgv } from "./argv";

export interface RhythmCliCommandContext {
  args: Record<string, string>;
}

function toSegments(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function matchCommand(pattern: string[], positionals: string[]): Record<string, string> | null {
  if (pattern.length !== positionals.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const segment = pattern[i]!;
    const token = positionals[i]!;
    if (segment.startsWith(":")) {
      params[segment.slice(1)] = token;
    } else if (segment !== token) {
      return null;
    }
  }
  return params;
}

export interface RhythmCliOptions {
  name?: string;
  prefix?: string;
}

const RhythmCliTag = Symbol("RhythmCliTag");

type CommandEntry = {
  kind: "command";
  segments: string[];
  handlers: Middleware<any>[];
};

type MiddlewareEntry = {
  kind: "middleware";
  fn: Middleware<any>;
};

type Entry = CommandEntry | MiddlewareEntry;

type CompiledCommand = {
  segments: string[];
  dispatch: (context: any, next?: NextFn<any>) => Promise<any>;
};

type TaggedMiddleware = Middleware<any> & { [RhythmCliTag]?: RhythmCli<any, any> };

export class RhythmCli<
  TContext extends RhythmCliContext = RhythmCliContext,
  TProviders extends object = {},
> extends Rhythm<RhythmCliContext, TContext, TProviders> {
  #prefixSegments: string[];
  #entries: Entry[] = [];
  #commands: CompiledCommand[] = [];
  #dispatchInstalled = false;

  constructor(options: RhythmCliOptions = {}) {
    super({ name: options.name ?? "cli", type: "controller" });
    this.#prefixSegments = options.prefix ? toSegments(options.prefix) : [];
  }

  override use<TExtra extends object = {}>(fn: Middleware<TContext>): RhythmCli<TContext & TExtra, TProviders> {
    const nested = (fn as TaggedMiddleware)[RhythmCliTag];
    if (nested) {
      for (const entry of nested.#entries) this.#mount(entry);
    } else {
      this.#entries.push({ kind: "middleware", fn });
      super.use(fn);
    }
    return this as unknown as RhythmCli<TContext & TExtra, TProviders>;
  }

  override provide<TValue extends object>(
    factory: (deps: DeepReadonly<TProviders>) => TValue | Promise<TValue>,
    dispose?: (value: TValue) => void | Promise<void>,
  ): RhythmCli<TContext & OmitHashKeys<TValue>, TProviders & OmitHashKeys<TValue>> {
    super.provide(factory, dispose);
    return this as unknown as RhythmCli<TContext & OmitHashKeys<TValue>, TProviders & OmitHashKeys<TValue>>;
  }

  override register(): never {
    throw new Error("RhythmCli is a controller and cannot register() other modules or controllers");
  }

  #mount(entry: Entry): void {
    if (entry.kind === "middleware") {
      this.#entries.push(entry);
      super.use(entry.fn);
      return;
    }
    this.#registerCommand([...this.#prefixSegments, ...entry.segments], entry.handlers);
  }

  #registerCommand(segments: string[], handlers: Middleware<any>[]): void {
    this.#entries.push({ kind: "command", segments, handlers });
    this.#commands.push({ segments, dispatch: compose(handlers) });

    if (this.#dispatchInstalled) return;
    this.#dispatchInstalled = true;

    const commands = this.#commands;
    super.use(async (ctx, next) => {
      const { positionals } = parseArgv(ctx.argv);
      for (const cmd of commands) {
        const params = matchCommand(cmd.segments, positionals);
        if (!params) continue;
        await cmd.dispatch(
          { ...ctx, args: params } as TContext & RhythmCliCommandContext,
          next as unknown as NextFn<TContext & RhythmCliCommandContext>,
        );
        return;
      }
      await next();
    });
  }

  command(path: string, ...handlers: Middleware<TContext & RhythmCliCommandContext>[]): this {
    this.#registerCommand([...this.#prefixSegments, ...toSegments(path)], handlers);
    return this;
  }

  commands(): Middleware<TContext> {
    const mw = this.middleware() as TaggedMiddleware;
    mw[RhythmCliTag] = this;
    return mw;
  }
}
