# @rhythmjs/cli

The command-line layer of Rhythm, the Bun-native backend framework: CLI command routing on top of the `@rhythmjs/rhythm` kernel. `RhythmCli` matches commands against argv positional tokens with a simple linear scan (appropriate for the handful-to-dozens of commands a real CLI has), supports prefixes and nested command groups, and mounts flat into a parent `Rhythm` app via `.use(cli.commands())`, so an unmatched command correctly falls through to whatever's registered after it.

`RhythmCli` is not an app and does not extend `Rhythm`; it is a controller that compiles commands and middleware down to a single middleware (`.commands()`). It shares the core middleware contract (`compose`, `Middleware`, `next(extra)`), but has no `provide()` or `register()`, and it can't be served on its own: a `Rhythm` app is always the host that owns the lifecycle.

## Example

```ts
import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmCli } from "@rhythmjs/cli";
import { toCliHandler } from "@rhythmjs/cli/run";
import type { RhythmCliContext } from "@rhythmjs/cli/context";

const cli = new RhythmCli().command("deploy :environment", (ctx) => {
  ctx.response.print(`deploying to ${ctx.args.environment}`);
});

const app = new Rhythm<RhythmCliContext>().use(cli.commands());
process.exitCode = await toCliHandler(app)(process.argv.slice(2));
```

A fuller runnable version, including nested command groups and interactive prompts, is at [`examples/cli`](../../examples/cli).

## Concepts

- **`ctx.response`**: `print(line)`, `printError(line)`, `exit(code)`, all chainable. Flushed to the console and returned as the process exit code by the adapter.
- **`ctx.args`**: captured `:name` command tokens, added once a command matches.
- **`ctx.flags`**: parsed `--foo` / `--foo=bar` / `-f` options. Schema-less: a bare `--foo` is boolean `true`, `--foo bar` takes the next token as its value unless the token itself looks like a flag, the same default behavior as `minimist`.
- **`ctx.stdin`**: a `ReadableStream`, or `null` when stdin is a TTY (nothing piped in).
- **Interactive prompts**: `createPrompt()` gives `text()`/`confirm()`/`select()`/`multiSelect()` (the latter two support an `allowCustom` option that adds a "type your own" choice). Wire it in via a `.provide()` on the host `Rhythm` app; see the example.
- **Prefixes compose across nesting**: a child cli mounted into a prefixed parent via `.use(child)` gets the parent's prefix segments joined onto every one of its commands, at any nesting depth. Mounting copies the child's commands and middleware at that moment; commands added to the child afterwards don't appear in the parent, and the child keeps working standalone.
- **Registration order is execution order**: a `.use()` middleware wraps only the commands registered after it; commands registered before it are untouched, and a matched command that doesn't call `next()` returns without reaching anything registered later. An unmatched command falls through, entry by entry, to the outer `next()`.
- **A cli is a controller, not a module**: it has no `provide()` or `register()`, and it cannot be `register()`ed into a `Rhythm` app either; `register()` composes `Rhythm` modules only. A cli mounts into an app exactly one way: koa-style, via `.use(cli.commands())`.

## API

- `new RhythmCli(options?)`: `options.prefix` (space-separated, e.g. `"remote"`).
- `.command(path, ...handlers)`: register a command; `path` is space-separated and may contain `:param` tokens (e.g. `"deploy :environment"`).
- `.use(fn)`: plain middleware. `.use(child)`: mount a nested `RhythmCli` (prefixes compose).
- `.commands()`: this CLI as a plain middleware, for mounting into a `Rhythm` app via `.use()`; the cli's only way onto a runtime. Note: mounting a _cli_ into a _cli_ must use `.use(child)`, not `.use(child.commands())`, because an opaque middleware can't have the parent's prefix applied to its commands.
- `toCliHandler(app)`: bridges a `Rhythm` app to `(argv: string[]) => Promise<number>`.
- `createPrompt()`: a `{ text, confirm, select, multiSelect }` prompt reading lines through Bun's async-iterable `console`, for use inside a `.provide()` on the host app.

## Running on Bun

`@rhythmjs/cli/run` is the runtime half, coupled to Bun on purpose: `toCliHandler(app)` reads piped input through `Bun.stdin.stream()` (a TTY leaves `ctx.stdin` null), and `createPrompt()` reads answer lines through Bun's async-iterable `console`.
