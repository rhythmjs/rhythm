import { compose } from "@rhythmjs/rhythm/compose";
import type { Middleware, NextFn } from "@rhythmjs/rhythm/types";
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
  prefix?: string;
}

type Entry =
  | { kind: "middleware"; fn: Middleware<any> }
  | { kind: "command"; segments: string[]; handlers: Middleware<any>[] };

export class RhythmCli<TContext extends RhythmCliContext = RhythmCliContext> {
  #options: RhythmCliOptions;
  #entries: Entry[] = [];
  #composed: ((context: TContext, next?: NextFn<TContext>) => Promise<TContext>) | null = null;

  constructor(options: RhythmCliOptions = {}) {
    this.#options = options;
  }

  get #prefixSegments(): string[] {
    return this.#options.prefix ? toSegments(this.#options.prefix) : [];
  }

  use(child: RhythmCli<any>): this;
  use<TExtra extends object = {}>(fn: Middleware<TContext>): RhythmCli<TContext & TExtra>;
  use(arg: Middleware<TContext> | RhythmCli<any>): RhythmCli<any> {
    if (arg instanceof RhythmCli) {
      for (const entry of arg.#entries) {
        this.#entries.push(
          entry.kind === "command" ? { ...entry, segments: [...this.#prefixSegments, ...entry.segments] } : entry,
        );
      }
    } else {
      if (typeof arg !== "function") throw new TypeError("middleware must be a function!");
      this.#entries.push({ kind: "middleware", fn: arg });
    }
    this.#composed = null;
    return this;
  }

  command(path: string, ...handlers: Middleware<TContext & RhythmCliCommandContext>[]): this {
    this.#entries.push({ kind: "command", segments: [...this.#prefixSegments, ...toSegments(path)], handlers });
    this.#composed = null;
    return this;
  }

  #compile(): (context: TContext, next?: NextFn<TContext>) => Promise<TContext> {
    if (this.#composed) return this.#composed;

    type CommandDispatch = (context: TContext & RhythmCliCommandContext, next?: NextFn<any>) => Promise<unknown>;
    type CompiledCommand = { segments: string[]; dispatch: CommandDispatch };

    const dispatchFor = (compiled: CompiledCommand[]): Middleware<any> => {
      return async (ctx, next) => {
        const { positionals } = parseArgv(ctx.argv);
        for (const command of compiled) {
          const args = matchCommand(command.segments, positionals);
          if (!args) continue;
          await command.dispatch({ ...ctx, args } as TContext & RhythmCliCommandContext, next);
          return;
        }
        await next();
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
      const compiled: CompiledCommand[] = [];
      while (i < this.#entries.length) {
        const command = this.#entries[i]!;
        if (command.kind !== "command") break;
        compiled.push({ segments: command.segments, dispatch: compose(command.handlers) as CommandDispatch });
        i++;
      }
      stack.push(dispatchFor(compiled));
    }

    this.#composed = compose<TContext>(stack);
    return this.#composed;
  }

  commands(): Middleware<TContext> {
    return async (ctx, next) => {
      await this.#compile()(ctx as unknown as TContext, next);
    };
  }
}
