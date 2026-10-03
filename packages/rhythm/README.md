# @rhythmjs/rhythm

The composition kernel at the core of Rhythm, the Bun-native backend framework, the piece `@rhythmjs/router` and `@rhythmjs/cli` are built on. It gives an application its structure (onion middleware, startup-time context, encapsulated modules, all checked at compile time) and deliberately nothing else: no router, no HTTP layer, and never will be.

## Concepts

- **Onion middleware**: `use()` wraps downstream steps, running code before _and_ after `next()`.
- **Startup vs request time**: Rhythm only handles request time. Anything created at startup (a DB connection, a config object) is created by you, before serving, and handed to the app by assigning to `app.context`. Rhythm has no setup or teardown phase; you close what you opened.
- **Startup context**: `app.context` is a plain object typed by the second type parameter, `Rhythm<TInput, TStartup>`. Everything assigned to it is on every request context. Declare the shape once; assignments and reads are then checked.
- **Encapsulated modules**: `register()` mounts a child `Rhythm`; its context stays sealed unless you explicitly export fields from it.
- **Readonly context**: the context passed to middleware is deeply readonly at the type level; `next()` takes no arguments (pure Koa style), so state only changes via `derive()` or startup `context`, or through a value branded with the `RhythmMutable` symbol (how `RhythmRouter`/`RhythmCli`'s response objects stay mutable).

## Example

```ts
import { Rhythm } from "@rhythmjs/rhythm";

const app = new Rhythm<{ userId: string }, { logger: { info(msg: string): void } }>()
  .use(async (ctx, next) => {
    const startedAt = Date.now();
    await next();
    ctx.logger.info(`handled in ${Date.now() - startedAt}ms`);
  })
  .use((ctx) => {
    ctx.logger.info(`hello, ${ctx.userId}`);
  });

app.context.logger = { info: (msg) => console.log(`[greeter] ${msg}`) };

await app.run({ userId: "u1" });
```

On each `run()`, the middleware chain executes in registration order, onion-style.

### Startup values

```ts
const app = new Rhythm<{ userId: string }, { db: Db }>() // second parameter: the startup shape
  .register(usersModule); // usersModule: Rhythm<{ userId: string; db: Db }> sees db

app.context.db = await createDb(); // startup time: yours to create and close
app.context.db = 1; // type error: not a Db
app.context.cache = x; // type error: not in the declared shape
```

TypeScript can't infer a type from a later property assignment, so the shape is declared once on the instance. `ctx.db` is then typed in every middleware, and `register()` rejects, at compile time, a module that requires context the parent's input and startup shape don't provide.

A registered module inherits its parent's context and can add its own through its own `module.context`. Those values are visible inside the module and to modules it registers, never to its parent. Per-request input wins over a startup value with the same key. Values are read when a request runs, so assign before serving; nothing checks that every declared key was assigned.

### Extending the context

`next()` accepts no parameters: middleware cannot pass values downstream through it. To add fields to the context, use `derive()`, which runs your function, merges the returned fields into the context, then calls `next()` for you. The new fields are inferred and visible to everything chained after it.

```ts
import { Rhythm, derive } from "@rhythmjs/rhythm";

const app = new Rhythm<{ userId: string }>()
  .use(derive((ctx) => ({ user: { id: ctx.userId, name: "Ada" } })))
  .use((ctx) => console.log(ctx.user.name));
```

Keys prefixed with `#` are dropped from the context. For long-lived resources, create them at startup and assign them to `app.context`.

### Module registration

```ts
import { Rhythm, derive } from "@rhythmjs/rhythm";

const authModule = new Rhythm<{ userId: string }, { db: Db }>({ name: "auth" }).use(
  derive((ctx) => ({ user: ctx.db.findUser(ctx.userId) })),
);
authModule.context.db = connectToUserDb();

const app = new Rhythm<{ userId: string }>()
  .register(authModule, (result) => ({ user: result.user })) // only `user` crosses back
  .use((ctx) => console.log(`hello, ${ctx.user.name}`));
```

The child runs in place: if it ends the chain without calling `next()`, the parent stops there.

## API

- `new Rhythm<TInput, TStartup>(options?)`: creates a pipeline; `options.name`/`options.type` label errors from `register()`.
- `.use(fn: (ctx, next) => Promise<void> | void, condition?: Condition)`: add an onion middleware step. With a second callback, the step runs only when `condition(ctx)` returns true and otherwise falls through to `next()`; a conditional `derive()` does not extend the context type. `next()` takes no arguments; to extend the context pass a `derive()` middleware.
- `derive(fn: (ctx) => TExtra | Promise<TExtra>)`: middleware that merges `fn`'s result into the context and continues; the typed way to add fields.
- `.context`: the startup values object, typed by `Rhythm<TInput, TStartup>`. Assign to it before serving; every request context carries it. Inherited by registered modules, never by the parent.
- `.register(other: Rhythm, exportValue?)`: mount a child `Rhythm` module; sealed by default, opt in via `exportValue`. Controllers (`RhythmRouter`, `RhythmCli`) are not modules; they mount via `.use()` instead.
- `.run(input)`: dispatches `input` through the middleware chain.
- `.callback()`: returns the cached, reusable `(input) => Promise<TContext>` handler `run()` uses internally.
- `.middleware()`: returns this instance as a plain middleware, for flat mounting into a parent via `.use()` instead of `.register()`.
- `.parent` / `.sources`: the module this one was registered into, and the tagged sources (routers, clis, any extension) below it in order, with registered modules expanded in place. Read lazily, once the app is assembled. Tag your own middleware with `withSource(fn, source)` from `@rhythmjs/rhythm/source`.
- `compose(middleware[])`: the standalone Koa-style onion dispatcher `Rhythm` is built on.
