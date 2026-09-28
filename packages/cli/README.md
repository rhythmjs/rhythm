# @rhythmjs/cli

CLI command routing on top of `@rhythmjs/rhythm`. `RhythmCli` matches commands against argv positional tokens with a simple linear scan (appropriate for the handful-to-dozens of commands a real CLI has), supports prefixes and nested command groups, and mounts flat into a parent via `.use(cli.commands())`, so an unmatched command correctly falls through to whatever's registered after it.

## Example

```ts
import { RhythmCli } from "@rhythmjs/cli";
import { toCliHandler } from "@rhythmjs/cli/adapters/bun";

const cli = new RhythmCli().command("deploy :environment", (ctx) => {
  ctx.response.print(`deploying to ${ctx.args.environment}`);
});

process.exitCode = await toCliHandler(cli)(process.argv.slice(2));
```

A fuller runnable version, including nested command groups and interactive prompts, is at [`examples/cli`](../../examples/cli).

## Concepts

- **`ctx.response`** — `print(line)`, `printError(line)`, `exit(code)`, all chainable. Flushed to the console and returned as the process exit code by the adapter.
- **`ctx.args`** — captured `:name` command tokens, added once a command matches.
- **`ctx.flags`** — parsed `--foo` / `--foo=bar` / `-f` options. Schema-less: a bare `--foo` is boolean `true`, `--foo bar` takes the next token as its value unless the token itself looks like a flag — same default behavior as `minimist`.
- **`ctx.stdin`** — a `ReadableStream`, or `null` when stdin is a TTY (nothing piped in).
- **Interactive prompts** — `createPrompt()` gives `text()`/`confirm()`/`select()`/`multiSelect()` (the latter two support an `allowCustom` option that adds a "type your own" choice). Wire it in via a normal `.provide()` — see the example.
- **`register()` is disabled** on `RhythmCli`, same reasoning as `RhythmRouter`.

## API

- `new RhythmCli(options?)` — `options.name`, `options.prefix` (space-separated, e.g. `"remote"`).
- `.command(path, ...handlers)` — register a command; `path` is space-separated and may contain `:param` tokens (e.g. `"deploy :environment"`).
- `.use(fn)` — plain middleware, or mount a nested `RhythmCli` via `.use(child.commands())`.
- `.commands()` — returns this CLI as a plain middleware, for mounting into a parent via `.use()`.
- `toCliHandler(app)` — bridges a `Rhythm`/`RhythmCli` app to `(argv: string[]) => Promise<number>`.
- `createPrompt()` — a readline-backed `{ text, confirm, select, multiSelect }` prompt, for use inside a `.provide()`.

## Runtime adapters

`RhythmCli` itself is runtime-agnostic; only stdin access and the interactive prompt's I/O touch a specific runtime.

- **`@rhythmjs/cli/adapters/bun`** — uses `Bun.stdin.stream()`, Bun's own native stdin API.
- **`@rhythmjs/cli/adapters/node`** — the portable version: `process.stdin` + `node:stream`'s `Readable.toWeb()`, and `node:readline` for `createPrompt()`. No Bun-specific API at all.
- **`@rhythmjs/cli/adapters/deno`** — re-exports the Node adapter unchanged. Deno's Node-compat layer implements `process.stdin`, `Readable.toWeb`/`fromWeb`, and `node:readline`, so the same code works correctly under Deno.
