import { compose } from "@rhythmjs/rhythm/compose";
import type { DeriveMiddleware, Middleware, NextFn } from "@rhythmjs/rhythm/types";
import type { RhythmCliContext } from "./context";
import { parseArgv } from "./argv";

export interface RhythmCliCommandContext {
  readonly args: Readonly<Record<string, string>>;
}

function toSegments(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

const isOptional = (segment: string) => segment.startsWith(":") && segment.endsWith("?");
const isCatchAll = (segment: string) => segment === "**";

function matchCommand(pattern: string[], positionals: string[]): Record<string, string> | null {
  const catchAll = isCatchAll(pattern.at(-1)!);
  const fixed = catchAll ? pattern.slice(0, -1) : pattern;
  const required = fixed.filter((segment) => !isOptional(segment)).length;
  if (positionals.length < required || (!catchAll && positionals.length > fixed.length)) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < fixed.length; i++) {
    const segment = fixed[i]!;
    const token = positionals[i];
    if (segment.startsWith(":")) {
      if (token !== undefined) params[segment.slice(1, isOptional(segment) ? -1 : undefined)] = token;
    } else if (segment !== token) {
      return null;
    }
  }
  if (catchAll && positionals.length > fixed.length) {
    params._ = positionals.slice(fixed.length).join(" ");
  }
  return params;
}

function assertValidPattern(path: string, segments: string[]): void {
  const rank = (segment: string) => (isCatchAll(segment) ? 2 : isOptional(segment) ? 1 : 0);
  for (let i = 1; i < segments.length; i++) {
    if (rank(segments[i]!) < rank(segments[i - 1]!)) {
      throw new TypeError(`optional params and a catch-all must come last, in that order, in command "${path}"`);
    }
  }
  if (segments.filter(isCatchAll).length > 1) {
    throw new TypeError(`command "${path}" has more than one catch-all`);
  }
}

export interface RhythmCliOptions {
  prefix?: string;
}

type Entry =
  { kind: "middleware"; fn: Middleware<any> } | { kind: "command"; segments: string[]; handlers: Middleware<any>[] };

export class RhythmCli<TContext extends RhythmCliContext = RhythmCliContext> {
  #options: RhythmCliOptions;
  #entries: Entry[] = [];

  constructor(options: RhythmCliOptions = {}) {
    this.#options = options;
  }

  get #prefixSegments(): string[] {
    return this.#options.prefix ? toSegments(this.#options.prefix) : [];
  }

  use<TExtra extends object>(fn: DeriveMiddleware<TContext, TExtra>): RhythmCli<TContext & TExtra>;
  use(fn: Middleware<TContext>): this;
  use(fn: Middleware<TContext>): any {
    if (typeof fn !== "function") throw new TypeError("middleware must be a function!");
    this.#entries.push({ kind: "middleware", fn });
    return this;
  }

  command<TExtra extends object>(
    path: string,
    middleware: DeriveMiddleware<TContext & RhythmCliCommandContext, TExtra>,
    ...handlers: Middleware<TContext & RhythmCliCommandContext & TExtra>[]
  ): this;
  command(path: string, ...handlers: Middleware<TContext & RhythmCliCommandContext>[]): this;
  command(path: string, ...handlers: Middleware<any>[]): this {
    const segments = toSegments(path);
    assertValidPattern(path, segments);
    this.#entries.push({ kind: "command", segments: [...this.#prefixSegments, ...segments], handlers });
    return this;
  }

  #compile(): (context: TContext, next?: NextFn<TContext>) => Promise<TContext> {
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

    return compose<TContext>(stack);
  }

  middleware(): Middleware<TContext> {
    const fn = this.#compile();
    return async (ctx, next) => {
      await fn(ctx as unknown as TContext, next);
    };
  }
}
