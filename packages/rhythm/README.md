# @rhythmjs/rhythm

The core composition kernel `@rhythmjs/router` and `@rhythmjs/cli` are built on. Framework-agnostic — no router, no HTTP layer, and never will be.

## Concepts

- **Onion middleware** — `use()` wraps downstream steps, running code before _and_ after `next()`.
- **Providers** — `provide()` registers a value or async factory that resolves once and is injected into every request's context. A returned key prefixed with `#` (e.g. `"#close"`) stays out of context but is still passed in full to `dispose()`.
- **Encapsulated modules** — `register()` mounts a child `Rhythm`; its context stays sealed unless you explicitly export fields from it.
- **Readonly context** — the context passed to middleware is deeply readonly at the type level; state only changes via `next(extra)`, or through a value branded with the `RhythmMutable` symbol (how `RhythmRouter`/`RhythmCli`'s response objects stay mutable).

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

`provide()` factories run once, in declaration order, each receiving everything resolved so far via `deps`. `use()` middleware runs on every `run()` call, in onion order.

### Module registration

```ts
const authModule = new Rhythm<{ userId: string }>({ name: "auth" })
  .provide(
    () => ({ db: connectToUserDb() }),
    (db) => db.close(),
  )
  .use(async (ctx, next) => {
    await next({ user: ctx.db.findUser(ctx.userId) });
  });

const app = new Rhythm<{ userId: string }>()
  .register(authModule, (result) => ({ user: result.user })) // only `user` crosses back
  .use((ctx) => console.log(`hello, ${ctx.user.name}`));
```

`register()` folds the child's `setup()`/`teardown()` into the parent's lifecycle.

## API

- `new Rhythm<TInput>(options?)` — creates a pipeline; `options.name`/`options.type` label errors from `register()`.
- `.use(fn: (ctx, next) => Promise<void> | void)` — add an onion middleware step.
- `.provide(factory: (deps) => TValue | Promise<TValue>, dispose?)` — register a provider; resolved once, disposed in reverse order on `teardown()`.
- `.register(other: Rhythm, exportValue?)` — mount a child module; sealed by default, opt in via `exportValue`.
- `.run(input)` — runs `setup()` if needed, dispatches `input` through the middleware chain.
- `.callback()` — returns the cached, reusable `(input) => Promise<TContext>` handler `run()` uses internally.
- `.middleware()` — returns this instance as a plain middleware, for flat mounting into a parent via `.use()` instead of `.register()` (what `RhythmRouter.routes()`/`RhythmCli.commands()` build on).
- `.setup()` — resolves all providers, cascading into registered modules. Idempotent; retryable on failure.
- `.teardown()` — disposes all providers in reverse order, cascading into registered modules.
- `compose(middleware[])` — the standalone Koa-style onion dispatcher `Rhythm` is built on.
