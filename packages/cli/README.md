# @rhythmjs/cli

The command-line layer of Rhythm, the Bun-native backend framework: command routing on top of the `@rhythmjs/rhythm` kernel. `RhythmCli` matches commands against the leading words of argv with [rou3](https://github.com/h3js/rou3), supports nested command groups (`db migrate`), optional and catch-all params, and runs per-command middleware chains.

`RhythmCli` is a `Pipeline`, like `Rhythm`: it has request-time `use()` middleware and commands, but no startup phase. It runs on its own through `toCliHandler(cli)`, or mounts into a `Rhythm` app with `mount(cli)` when you want startup work (`register`, `decorate`, `include`) around it.

## Example

```ts
import { RhythmCli } from "@rhythmjs/cli";
import { withParsedArgv } from "@rhythmjs/cli/argv";
import { toCliHandler } from "@rhythmjs/cli/run";

const cli = new RhythmCli({ name: "tool" })
  .use(withParsedArgv())
  .cmd("greet :name?", (ctx) => {
    const message = `hello ${ctx.params.name ?? "world"}`;
    ctx.log(ctx.flags.shout ? message.toUpperCase() : message);
  })
  .cmd(
    "deploy :env",
    (ctx, next) => {
      if (!["staging", "production"].includes(ctx.params.env))
        return ctx.fail(`unknown environment '${ctx.params.env}'`);
      return next();
    },
    (ctx) => ctx.log(`deployed to ${ctx.params.env}`),
  );

process.exitCode = await toCliHandler(cli)(Bun.argv.slice(2));
```

## Concepts

- **Commands.** `cmd(command, ...handlers)` takes a space-separated command (`"db migrate :name"`). Words are literal unless they start with `:`. Handlers are `(ctx, next)` middleware and form a chain; the first may be `derive()`, which widens the context type for the handlers after it. Matching uses the words before the first flag, so `deploy staging --force` matches `deploy :env`.
- **Params.** `:name` is required, `:name?` optional (absent when not given), `:name+` / `:name*` / `**:name` capture the remaining words as a `string[]` (`*` and `**` alone land in `params["0"]`). Values are URI-decoded. Params are typed from the command string: `:name` is `string`, `:name?` is `string | undefined`, catch-alls are `string[]`, and reading a name that is not in the command is a compile error.
- **Strict context.** The context only has what was added: `ctx.nope` is a compile error, `ctx.flags` only exists after `withParsedArgv()`, `ctx.prompt` only after `withPrompt()`, and `derive()` widens it for the handlers after it. A command-level `derive` only affects that command. `toCliHandler(app)` rejects, at compile time, an app that requires input the runner cannot supply.
- **Request-time middleware.** `cli.use(middleware)` wraps commands and runs only when a command matched, so a guard never answers an unknown command. `derive()` extends the context type.
- **Running and exit codes.** `toCliHandler(app, io?)` returns `(argv) => Promise<number>`: the exit code. It reports an unmatched command as `error: unknown command 'x'` (exit code 2, or `no command given`), and a thrown error as an error line (exit code 1). `app` can be a `RhythmCli`, or a `Rhythm` app that mounts one. Register `cmd("", handler)` to handle the no-argument case yourself.
- **Output.** The context carries `argv`, `stdout`, `stderr`, `exitCode`, and the helpers `log(...)` (stdout), `error(...)` (stderr) and `fail(message, code = 1)` (prints `error: message` to stderr and sets the exit code). Pass `io: { stdout, stderr }` to `toCliHandler` to capture output, e.g. in tests.
- **Named failures.** `new RhythmCli({ name })` labels failures when mounted: `mounted cli "tool" failed` with the original error as `cause`.

## Opt-in extensions

Nothing is added to the context unless you ask for it:

- **`withParsedArgv()`** (`@rhythmjs/cli/argv`) adds `ctx.flags` and `ctx.positionals`. Parsing is schema-less: `--foo=bar` and `--foo bar` give a string, a bare `--foo` (or one followed by another flag) is `true`, `-f` works the same way, and everything after `--` is positional. Like `minimist`, `--force now` consumes `now` as the value. `parseArgv(argv)` is the same parser as a plain function.
- **`withPrompt()`** (`@rhythmjs/cli/prompt`) adds `ctx.prompt` with `text()`, `confirm()`, `select()` and `multiSelect()` (the last two accept `allowCustom` to add a "type your own" choice) and closes its input when the command finishes. By default it reads lines through Bun's async-iterable `console`, only when you first ask; pass `() => ({ ask, write, close? })` to supply your own IO. `createPrompt(io)` is the same thing without the middleware.

```ts
const cli = new RhythmCli().use(withPrompt()).cmd("init", async (ctx) => {
  const name = await ctx.prompt.text("Project name?", { default: "my-app" });
  if (await ctx.prompt.confirm("Install dependencies?", { default: true })) ctx.log(`installing for ${name}`);
});
```

## With a Rhythm app

```ts
import { Rhythm, decorate, mount } from "@rhythmjs/rhythm";

const app = new Rhythm({ name: "tool" })
  .register(decorate(async () => ({ config: await loadConfig() })))
  .use(mount(cli));

process.exitCode = await toCliHandler(app)(Bun.argv.slice(2));
```

## API

- `new RhythmCli<I, D>(options?)`: `I` is context the CLI needs from the parent (checked by `mount()`), `D` is what its own `derive()` calls add; both are usually inferred. `options.name` labels failures (`type` defaults to `"cli"`).
- `.cmd(command, ...handlers)`: register a command.
- `.use(middleware)`: command-level middleware; `derive()` extends the context type.
- `.callback()`: the CLI as a `(ctx) => Promise<ctx>` function, used by `mount()` and `toCliHandler()`.
- `.sources` / `.parent` / `.options`: inherited from `Pipeline`.
- `createCliContext(argv, io?)` (`@rhythmjs/cli/context`): the base context with `log`, `error`, `fail` and `exitCode`.
- `toCliHandler(app, io?)` (`@rhythmjs/cli/run`): bridges a CLI or `Rhythm` app to `(argv) => Promise<number>`.
- `parseArgv(argv)`, `withParsedArgv()` (`@rhythmjs/cli/argv`); `createPrompt(io)`, `createStdioPromptIO()`, `withPrompt(createIO?)` (`@rhythmjs/cli/prompt`).

## Running on Bun

The runtime half is coupled to Bun on purpose: prompts read through Bun's async-iterable `console`, and nothing is adapted for other runtimes.
