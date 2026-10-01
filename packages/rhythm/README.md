# @rhythmjs/rhythm

The composition kernel at the core of Rhythm, the Bun-native backend framework, the piece `@rhythmjs/router` and `@rhythmjs/cli` are built on. It gives an application its structure (onion middleware, lifecycle-managed providers, encapsulated modules, all checked at compile time) and deliberately nothing else: no router, no HTTP layer, and never will be.

## Concepts

- **Onion middleware**: `use()` wraps downstream steps, running code before _and_ after `next()`.
- **Providers**: `provide()` registers a value or async factory that resolves once and joins the context at its position in the chain: only middleware (and mounted controllers) added after it see the value. A returned key prefixed with `#` (e.g. `"#close"`) stays out of context but is still passed in full to `dispose()`.
- **Encapsulated modules**: `register()` mounts a child `Rhythm`; its context stays sealed unless you explicitly export fields from it.
- **Readonly context**: the context passed to middleware is deeply readonly at the type level; `next()` takes no arguments (pure Koa style), so state only changes via `derive()` (or `provide()`), or through a value branded with the `RhythmMutable` symbol (how `RhythmRouter`/`RhythmCli`'s response objects stay mutable).

## Example

```ts
import { Rhythm } from "@rhythmjs/rhythm";

const app = new Rhythm<{ userId: string }>()
  .provide(() => ({ config: { serviceName: "greeter" } }))
  .provide((deps) => ({
    logger: { info: (msg: string) => console.log(`[${deps.config.serviceName}] ${msg}`) },
  }))
  .use(async (ctx, next) => {
    const startedAt = Date.now();
    await next();
    ctx.logger.info(`handled in ${Date.now() - startedAt}ms`);
  })
  .use((ctx) => {
    ctx.logger.info(`hello, ${ctx.userId}`);
  });

await app.run({ userId: "u1" });
await app.teardown();
```

`provide()` factories run once, in declaration order, each receiving everything resolved so far via `deps`. On each `run()`, the whole chain, middleware and provider injections alike, executes in registration order, onion-style: everything only applies to what was chained after it.

### Extending the context

`next()` accepts no parameters: middleware cannot pass values downstream through it. To add fields to the context, use `derive()`, which runs your function, merges the returned fields into the context, then calls `next()` for you. The new fields are inferred and visible to everything chained after it.

```ts
import { Rhythm, derive } from "@rhythmjs/rhythm";

const app = new Rhythm<{ userId: string }>()
  .use(derive((ctx) => ({ user: { id: ctx.userId, name: "Ada" } })))
  .use((ctx) => console.log(ctx.user.name));
```

Keys prefixed with `#` are dropped from the context. For long-lived resources with teardown, use `provide()` instead.

### Module registration

```ts
import { Rhythm, derive } from "@rhythmjs/rhythm";

const authModule = new Rhythm<{ userId: string }>({ name: "auth" })
  .provide(
    () => ({ db: connectToUserDb() }),
    (db) => db.close(),
  )
  .use(derive((ctx) => ({ user: ctx.db.findUser(ctx.userId) })));

const app = new Rhythm<{ userId: string }>()
  .register(authModule, (result) => ({ user: result.user })) // only `user` crosses back
  .use((ctx) => console.log(`hello, ${ctx.user.name}`));
```

`register()` folds the child's `setup()`/`teardown()` into the parent's lifecycle. The child runs in place: if it ends the chain without calling `next()`, the parent stops there.

## API

- `new Rhythm<TInput>(options?)`: creates a pipeline; `options.name`/`options.type` label errors from `register()`.
- `.use(fn: (ctx, next) => Promise<void> | void)`: add an onion middleware step. `next()` takes no arguments; to extend the context pass a `derive()` middleware.
- `derive(fn: (ctx) => TExtra | Promise<TExtra>)`: middleware that merges `fn`'s result into the context and continues; the typed way to add fields.
- `.provide(factory: (deps) => TValue | Promise<TValue>, dispose?)`: register a provider; resolved once, injected at its chain position, disposed in reverse order on `teardown()`.
- `.register(other: Rhythm, exportValue?)`: mount a child `Rhythm` module; sealed by default, opt in via `exportValue`. Controllers (`RhythmRouter`, `RhythmCli`) are not modules; they mount via `.use()` instead.
- `.run(input)`: runs `setup()` if needed, dispatches `input` through the middleware chain.
- `.callback()`: returns the cached, reusable `(input) => Promise<TContext>` handler `run()` uses internally.
- `.middleware()`: returns this instance as a plain middleware, for flat mounting into a parent via `.use()` instead of `.register()`.
- `.parent` / `.sources`: the module this one was registered into, and the tagged sources (routers, clis, any extension) below it in order, with registered modules expanded in place. Read lazily, once the app is assembled. Tag your own middleware with `withSource(fn, source)` from `@rhythmjs/rhythm/source`.
- `.setup()`: resolves all providers, cascading into registered modules. Idempotent; retryable on failure.
- `.teardown()`: disposes all providers in reverse order, cascading into registered modules.
- `compose(middleware[])`: the standalone Koa-style onion dispatcher `Rhythm` is built on.
