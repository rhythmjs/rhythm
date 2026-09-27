# RhythmJS

A minimal, type-safe composition kernel: onion-style middleware, lifecycle-managed providers, and encapsulated module registration. Framework-agnostic by design — it has no router, no HTTP layer, and never will; it's the core other packages get built on top of.

## Concepts

- **Onion middleware** — `use()` wraps downstream steps, running code before *and* after `next()`.
- **Providers** — `provide()` registers a value or async factory that resolves once and is injected into every request's context.
- **Encapsulated modules** — `register()` mounts a child `Pipeline`; its context stays sealed unless you explicitly export fields from it.
- **Readonly context** — the context passed to middleware is deeply readonly at the type level; state only changes via `next(extra)`.

## Example

```ts
const app = new Pipeline<{ userId: string }>()
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
const authModule = new Pipeline<{ userId: string }>("auth")
  .provide(
    () => ({ db: connectToUserDb() }),
    (db) => db.close(),
  )
  .use(async (ctx, next) => {
    await next({ user: ctx.db.findUser(ctx.userId) });
  });

const app = new Pipeline<{ userId: string }>()
  .register(authModule, (result) => ({ user: result.user })) // only `user` crosses back
  .use((ctx) => console.log(`hello, ${ctx.user.name}`));
```

`register()` folds the child's `setup()`/`teardown()` into the parent's lifecycle.

## API

- `new Pipeline<TInput>(name?)` — creates a pipeline; `name` labels errors from `register()`.
- `.use(fn: (ctx, next) => Promise<void> | void)` — add an onion middleware step.
- `.provide(factory: (deps) => TValue | Promise<TValue>, dispose?)` — register a provider; resolved once, disposed in reverse order on `teardown()`.
- `.register(other: Pipeline, exportValue?)` — mount a child pipeline; sealed by default, opt in via `exportValue`.
- `.run(input)` — runs `setup()` if needed, dispatches `input` through the middleware chain.
- `.callback()` — returns the cached, reusable `(input) => Promise<TContext>` handler `run()` uses internally.
- `.setup()` — resolves all providers, cascading into registered modules. Idempotent; retryable on failure.
- `.teardown()` — disposes all providers in reverse order, cascading into registered modules.
- `compose(middleware[])` — the standalone Koa-style onion dispatcher `Pipeline` is built on.

## Development

```sh
bun install
bun test
bun run typecheck
bun run dev
```

## License

ISC
