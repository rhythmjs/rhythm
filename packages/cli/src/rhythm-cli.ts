import { addRoute, createRouter, findRoute, type InferRouteParams } from "rou3";
import {
  Pipeline,
  compose,
  type ExtensionMiddleware,
  type Middleware,
  type Next,
  type PipelineOptions,
} from "@rhythmjs/rhythm";
import type { RhythmCliContext } from "./context";

export type CliContext<T extends object> = T & RhythmCliContext;

export type UseContext<T extends object> = CliContext<T> & { readonly params: Record<string, string | string[]> };

type ToPath<Command extends string> = Command extends `${infer Word} ${infer Rest}`
  ? `${Word}/${ToPath<Rest>}`
  : Command;

type CatchAllWord<Word extends string> = Word extends `**:${infer Name}`
  ? Name
  : Word extends `:${infer Name}+`
    ? Name
    : Word extends `:${infer Name}*`
      ? Name
      : Word extends "*" | "**"
        ? "0"
        : never;

type CatchAllKey<Command extends string> = Command extends `${infer Word} ${infer Rest}`
  ? CatchAllWord<Word> | CatchAllKey<Rest>
  : CatchAllWord<Command>;

type Flatten<T> = { [K in keyof T]: T[K] } & {};

export type CommandParams<C extends string> = Flatten<
  Omit<InferRouteParams<`/${ToPath<C>}`>, CatchAllKey<C> | "_"> & {
    [K in CatchAllKey<C>]: string[];
  }
>;

export type CommandContext<T extends object, C extends string> = CliContext<T> & {
  params: CommandParams<C>;
};

export type CommandHandler<T extends object, C extends string> = (
  ctx: CommandContext<T, C>,
  next: Next,
) => unknown | Promise<unknown>;

export type CommandHandlers<T extends object, C extends string> = [CommandHandler<T, C>, ...CommandHandler<T, C>[]];

type Route<T extends object> = {
  run: (ctx: CliContext<T>) => Promise<void>;
  catchAll: string | undefined;
};

const isFlag = (token: string) => token.startsWith("-") && token !== "-";

const lookupPath = (words: string[]) => `/${words.map(encodeURIComponent).join("/")}`;

function catchAllKey(words: string[]): string | undefined {
  for (const word of words) {
    const named = /^\*\*:(\w+)$/.exec(word) ?? /^:(\w+)[+*]$/.exec(word);
    if (named) return named[1];
    if (word === "*" || word === "**") return "0";
  }
  return undefined;
}

function decodeParams(params: Record<string, string> | undefined, catchAll: string | undefined) {
  const decoded: Record<string, string | string[]> = {};
  try {
    for (const [key, value] of Object.entries(params ?? {})) {
      if (key === "_" && catchAll === "0") continue;
      decoded[key] =
        key === catchAll ? value.split("/").filter(Boolean).map(decodeURIComponent) : decodeURIComponent(value);
    }
  } catch {
    return undefined;
  }
  if (catchAll !== undefined) decoded[catchAll] ??= [];
  return decoded;
}

export class RhythmCli<I extends object = {}, D extends object = {}> extends Pipeline<UseContext<I & D>> {
  declare readonly "~input"?: I;

  #routes = createRouter<Route<I & D>>();

  constructor(options?: PipelineOptions) {
    super({ type: "cli", ...options });
  }

  override use<U extends object>(middleware: ExtensionMiddleware<UseContext<I & D>, U>): RhythmCli<I, D & U>;
  override use(middleware: Middleware<UseContext<I & D>>): this;
  override use(middleware: Middleware<UseContext<I & D>>) {
    return super.use(middleware);
  }

  cmd<C extends string, U extends object>(
    command: C,
    middleware: ExtensionMiddleware<CommandContext<I & D, C>, U>,
    ...handlers: CommandHandler<I & D & U, C>[]
  ): this;
  cmd<C extends string>(command: C, ...handlers: CommandHandlers<I & D, C>): this;
  cmd(command: string, ...handlers: Middleware<any>[]): this {
    const chain = compose(handlers as Middleware<CliContext<I & D>>[]);
    const words = command.trim().split(/\s+/).filter(Boolean);
    addRoute(this.#routes, "", `/${words.join("/")}`, {
      run: (ctx) => chain(ctx),
      catchAll: catchAllKey(words),
    });
    return this;
  }

  override callback() {
    const run = this.chain();
    return async (input: CliContext<I>) => {
      const ctx = input as CliContext<I & D>;
      const match = this.#match(ctx);
      if (!match) return ctx;
      Object.assign(ctx, { params: match.params });
      await run(ctx as UseContext<I & D>, () => match.route.run(ctx));
      return ctx;
    };
  }

  #match(ctx: CliContext<I & D>) {
    const end = ctx.argv.findIndex(isFlag);
    const words = end === -1 ? ctx.argv : ctx.argv.slice(0, end);
    const found = findRoute(this.#routes, "", lookupPath(words));
    if (!found) return undefined;
    const params = decodeParams(found.params, found.data.catchAll);
    if (!params) return undefined;
    return { route: found.data, params };
  }
}
