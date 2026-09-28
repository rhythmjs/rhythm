# @rhythmjs/router

Web-standard HTTP routing on top of `@rhythmjs/rhythm`. `RhythmRouter` matches routes with a compressed radix tree (a static segment always wins over a `:param` segment, regardless of registration order), supports prefixes and nested routers, and mounts flat into a parent `Rhythm` app via `.use(router.routes())`, so an unmatched request correctly falls through to whatever's registered after it.

`RhythmRouter` is not an app and does not extend `Rhythm` — it is a controller that compiles routes and middleware down to a single middleware (`.routes()`). It shares the core middleware contract (`compose`, `Middleware`, `next(extra)`), but has no `provide()` or `register()`, and it can't be served on its own: a `Rhythm` app is always the host that owns the lifecycle and the adapters.

## Example

```ts
import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmRouter } from "@rhythmjs/router";
import { toFetchHandler } from "@rhythmjs/router/adapters/bun";
import type { RhythmHttpContext } from "@rhythmjs/router/adapters/context";

const usersRouter = new RhythmRouter({ prefix: "/users" }).get("/:id", (ctx) => {
  ctx.response.body = JSON.stringify({ id: ctx.params.id });
});

const app = new Rhythm<RhythmHttpContext>().use(usersRouter.routes());
Bun.serve({ fetch: toFetchHandler(app) });
```

A fuller runnable version, including nested prefixes and a fallback route, is at [`examples/router`](../../examples/router).

## Concepts

- **`ctx.response`** is a plain mutable object (`status`, `statusText`, `headers`, `body`) — set it directly rather than constructing a `Response` yourself. The adapter converts it to a real `Response` at the end.
- **`ctx.params`** — captured `:name` path segments, added once a route matches.
- **Prefixes compose across nesting** — a child router mounted into a prefixed parent via `.use(child)` gets the parent's prefix joined onto every one of its routes, at any nesting depth. Mounting copies the child's routes and middleware at that moment; routes added to the child afterwards don't appear in the parent, and the child keeps working standalone.
- **Registration order is execution order** — a `.use()` middleware wraps only the routes registered after it; routes registered before it are untouched, and a matched route that doesn't call `next()` returns without reaching anything registered later. Consecutive routes share one radix tree lookup; an unmatched request falls through, entry by entry, to the outer `next()`.
- **A router is a controller, not a module** — it has no `provide()` or `register()`, and it cannot be `register()`ed into a `Rhythm` app either; `register()` composes `Rhythm` modules only. A router mounts into an app exactly one way: koa-style, via `.use(router.routes())`.

## API

- `new RhythmRouter(options?)` — `options.prefix`.
- `.get/.post/.put/.patch/.delete(path, ...handlers)` — register a route; `path` may contain `:param` segments.
- `.use(fn)` — plain middleware. `.use(child)` — mount a nested `RhythmRouter` (prefixes compose).
- `.routes()` — this router as a plain middleware, for mounting into a `Rhythm` app via `.use()`; the router's only way onto a server. Note: mounting a _router_ into a _router_ must use `.use(child)`, not `.use(child.routes())` — an opaque middleware can't have the parent's prefix applied to its routes.
- `toFetchHandler(app)` — bridges a `Rhythm` app to a Web-standard `(Request) => Promise<Response>` handler.

## Runtime adapters

Everything above (`RhythmRouter`, `ctx.response`, etc.) is runtime-agnostic; only turning it into an actual server touches a specific runtime.

- **`@rhythmjs/router/adapters/bun`** — `toFetchHandler(app)`, for `Bun.serve({ fetch: toFetchHandler(app) })`.
- **`@rhythmjs/router/adapters/deno`** — re-exports the same `toFetchHandler`, for `Deno.serve(toFetchHandler(app))`. `Deno.serve()` accepts the identical `(Request) => Promise<Response>` shape `Bun.serve()` does, so no conversion is needed.
- **`@rhythmjs/router/adapters/node`** — `toNodeHandler(app, options?)`, for `http.createServer(toNodeHandler(app)).listen(port)`. Node's `IncomingMessage`/`ServerResponse` aren't Web-standard, so this one does real conversion:
  - The request body is read eagerly into a buffer, up to `options.bodyLimit` (default 1mb). This guarantees the socket is always fully drained before the handler runs, even if the handler never reads `ctx.request`'s body — otherwise, on a keep-alive connection, unconsumed bytes left on the socket would stall the next request on it. A body over the limit gets a `413` and the connection is closed rather than kept alive.
  - Pass `{ bodyLimit: false }` to opt out of buffering — `ctx.request`'s body becomes a live stream over the raw connection instead, with no size limit, for uploads or proxying where materializing the whole body in memory isn't acceptable. This reintroduces the keep-alive caveat: if the handler doesn't read the body, unconsumed bytes are left on the socket.
  - The resulting `Response` is streamed back to the client via `Readable.fromWeb(...).pipe(res)`.
  - Errors thrown anywhere in the middleware chain are caught, logged via `console.error`, and answered with a 500 (or the connection is destroyed if headers were already sent) — without this, an unhandled rejection would crash the whole Node process.
