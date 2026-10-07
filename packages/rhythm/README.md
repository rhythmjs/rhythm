# @rhythmjs/rhythm

The composition kernel at the core of Rhythm, the Bun-native backend framework, the piece `@rhythmjs/router` and `@rhythmjs/cli` are built on. It gives an application its structure (startup-time setup, request-time onion middleware, encapsulated modules, all checked at compile time) and deliberately nothing else: no router, no HTTP layer, and never will be.

## Concepts

Rhythm separates **when** something happens:

- **Startup time: `register()`.** Runs a callback once against the app's shared startup context: immediately, or, if an earlier `register` is still pending, right after it settles, so a callback always sees what the ones before it added (a failed one skips the rest and fails the app). Use it to create what lives for the whole process (a DB connection, config) and, optionally, how to close it. `stop()` runs the cleanups in reverse order.
- **Request time: `use()`.** Adds an onion middleware step that runs on every call of the handler, before _and_ after `next()`.

Four small composable functions plug into those two methods, each for one purpose:

| Function                 | Goes in    | Purpose                                                                 |
| ------------------------ | ---------- | ----------------------------------------------------------------------- |
| `decorate(fn)`           | `register` | Add typed fields to the startup context.                                |
| `derive(fn)`             | `use`      | Add typed fields to the request context, then continue.                 |
| `mount(plugin, cond?)`   | `use`      | Run another pipeline (a `Rhythm`, router, CLI) for each request.        |
| `include(module, pick?)` | `register` | Run a `Rhythm` module once at startup and pull selected fields from it. |

The context is a plain object, and it is **strictly typed**: `Rhythm<S, I, D>` tracks the startup fields added by `register` (`S`), the input the caller must supply per call (`I`), and the request fields added by `derive` (`D`). Types grow as you chain and nothing is declared twice. Reading a field that was never added is a compile error, a field added by `derive` is not visible to `register`, and a field is only visible to the steps after the one that added it.

```ts
new Rhythm()
  .use((ctx) => ctx.user) // error: not added yet
  .use(derive(() => ({ user: { name: "ada" } })))
  .use((ctx) => ctx.user.name) // string
  .use((ctx) => ctx.nope); // error: never added
```

To add a field, use `decorate` or `derive`; plain assignment to an unknown field is rejected on purpose.

## Example

```ts
import { Rhythm, decorate, derive } from "@rhythmjs/rhythm";

const app = new Rhythm({ name: "app" })
  .register(
    decorate(() => ({ startedAt: Date.now() })), // startup: runs now
    (ctx) => console.log(`stopped after ${Date.now() - ctx.startedAt}ms`), // cleanup: runs on stop()
  )
  .use(derive(() => ({ requestId: crypto.randomUUID() }))) // request: runs on every call
  .use(async (ctx, next) => {
    console.log(`[${ctx.requestId}] up for ${Date.now() - ctx.startedAt}ms`);
    await next();
  });

const handle = app.callback();
await handle(); // one request
await app.stop(); // shut down
```

## Startup: `register()`

`register(callback, cleanup?)` calls `callback(ctx, app)` with the shared startup context, right away unless an earlier `register` is still pending. Registrations run in order, so a callback sees everything the earlier ones added, even async ones (`include`, a database connection). Return a promise and the first request waits for it; if one fails, the later ones are skipped and the first request rejects. `cleanup(ctx, app)` is optional and runs on `stop()`; if several cleanups throw, `stop()` still runs all of them and rejects with an `AggregateError`. `Rhythm` is also `AsyncDisposable`, so `await using app = ...` stops it for you.

```ts
const app = new Rhythm().register(
  decorate(async () => ({ db: await connect() })),
  (ctx) => ctx.db.close(),
);
```

`decorate(fn)` is the typed way to add fields at startup: the returned object is merged into the startup context and `ctx.db` is typed for everything after it. A plain callback works too when you only need a side effect.

## Request: `use()` and `derive()`

`use(middleware)` takes `(ctx, next) => unknown`. `next()` takes no arguments; to add fields to the context use `derive()`, which runs your function (sync or async), merges the result, and calls `next()` for you. Every call of the handler gets a fresh copy of the startup context, so request-time changes never leak between requests.

```ts
const app = new Rhythm().use(derive((ctx) => ({ user: lookup(ctx.userId) }))).use((ctx) => console.log(ctx.user.name));
```

### Typed input

The second type parameter is input the caller must pass to the handler on each call. It is checked at compile time: `callback()` returns a function that requires `I` when it has required fields and makes it optional otherwise.

```ts
const app = new Rhythm<{}, { userId: string }>().use((ctx) => console.log(ctx.userId));

await app.callback()({ userId: "u1" });
await app.callback()(); // type error: userId is required
```

## Composing pipelines

### `mount(plugin, condition?)`: request time

Runs another pipeline against the current request, then continues with `next()`. The optional `condition(ctx)` decides per request whether it runs.

```ts
app.use(mount(routes)); // a RhythmRouter, a RhythmCli, or another Rhythm
app.use(mount(metrics, () => Bun.env.METRICS !== "off"));
```

A mounted `Rhythm` module gets a copy of the context, so what it derives stays sealed inside it; routers and CLIs work on the request context itself (params, response). `mount` checks, at compile time, that the parent's context can supply the plugin's required input (`RhythmRouter<I>` and `RhythmCli<I>` declare theirs the same way). A mounted plugin's own derived fields never leak into the parent's type.

### `include(module, pick?)`: startup time

Runs a `Rhythm` module's pipeline once, at registration, with the parent's startup context as input, and registers the module's `stop()` as a cleanup of the parent. `pick(child)` copies chosen fields from the module's finished context into the parent's startup context (typed); without it nothing crosses back.

```ts
const database = new Rhythm({ name: "database", type: "service" }).register(
  decorate(async () => ({ db: await connect() })),
  (ctx) => ctx.db.close(),
);

const app = new Rhythm().register(include(database, (child) => ({ db: child.db })));
```

## Errors, names and sources

- **Named failures.** `new Rhythm({ name, type })` (also accepted by `RhythmRouter` and `RhythmCli`) labels the plugin. A failure inside a mounted or included plugin is rethrown as `mounted service "billing" failed` / `included module "db" failed` with the original error as `cause`. Errors raised downstream of the mount are not attributed to the plugin. Without options the label is `module "anonymous"`.
- **Sources.** `mount()` and `include()` tag themselves with the plugin they wrap. `pipeline.sources` lists the leaf plugins (routers, CLIs, anything tagged with `withSource(fn, source)`) below it, with `Rhythm` modules expanded in place, and `pipeline.parent` is the pipeline a plugin was adopted by. Tooling such as OpenAPI generation or help output uses this to find what an app is made of.

## API

- `new Rhythm<S, I, D>(options?)`: startup, input and derived context types (all inferred as you chain, only `I` is usually written by hand); `options.name` / `options.type` label failures.
- `.register(callback, cleanup?)`: startup step; returns the app with its type extended when given `decorate()`/`include()`.
- `.use(middleware)`: request step; `derive()` extends the type.
- `.callback()`: returns the reusable `(input?) => Promise<ctx>` handler (input required when `I` has required fields). Built from the middleware registered so far.
- `.stop()` / `[Symbol.asyncDispose]()`: run the cleanups in reverse order.
- `.sources` / `.parent` / `.options`: introspection, available on every `Pipeline`.
- `decorate(fn)`, `derive(fn)`, `mount(plugin, condition?)`, `include(module, pick?)`: the composables above.
- `Pipeline<C>`: abstract base shared by `Rhythm`, `RhythmRouter` and `RhythmCli`: `use()`, `sources`, `parent`, `options`, and a protected `chain()`. Extend it to build your own controller.
- `compose(middleware[])`: the standalone Koa-style onion dispatcher everything is built on.
- `withSource(fn, source)` / `sourceOf(fn)`: tag and read a middleware's source.

Each function also has its own entry point (`@rhythmjs/rhythm/derive`, `/decorate`, `/mount`, `/include`, `/compose`, `/pipeline`, `/source`, `/types`); the root export re-exports them all.
