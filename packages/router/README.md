# @rhythmjs/router

Web-standard HTTP routing on top of `@rhythmjs/rhythm`. `RhythmRouter` matches routes with a compressed radix tree (a static segment always wins over a `:param` segment, regardless of registration order), supports prefixes and nested routers, and mounts flat into a parent via `.use(router.routes())` — koa-style, so an unmatched request correctly falls through to whatever's registered after it.

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

- **`ctx.response`** is a plain mutable object (`status`, `statusText`, `headers`, `body`) — set it directly, koa-style, rather than constructing a `Response` yourself. The adapter converts it to a real `Response` at the end.
- **`ctx.params`** — captured `:name` path segments, added once a route matches.
- **Prefixes compose across nesting** — a router mounted into a prefixed parent via `.use(child.routes())` gets the parent's prefix joined onto every one of its routes, at any nesting depth.
- **`register()` is disabled** on `RhythmRouter` — a router is a "controller"; it composes routes and middleware, not other modules. Mount it into a module with `.use(router.routes())`, not `.register()`.

## API

- `new RhythmRouter(options?)` — `options.name`, `options.prefix`.
- `.get/.post/.put/.patch/.delete(path, ...handlers)` — register a route; `path` may contain `:param` segments.
- `.use(fn)` — plain middleware, or mount a nested `RhythmRouter` via `.use(child.routes())`.
- `.routes()` — returns this router as a plain middleware, for mounting into a parent via `.use()`.
- `toFetchHandler(app)` (from `@rhythmjs/router/adapters/bun`) — bridges a `Rhythm`/`RhythmRouter` app to a Web-standard `(Request) => Promise<Response>` handler.
