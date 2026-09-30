# @rhythmjs/router

Web-standard HTTP routing on top of `@rhythmjs/rhythm`. `RhythmRouter` matches routes with [rou3](https://github.com/h3js/rou3), the router that powers h3 (a static segment always wins over a `:param` segment, regardless of registration order), supports prefixes and nested routers, and mounts flat into a parent `Rhythm` app via `.use(router.middleware())`, so an unmatched request correctly falls through to whatever's registered after it.

Route patterns follow rou3's conventions: `:name` params (`:name?` optional, `:id(\\d+)` regex-constrained), `*` for one unnamed segment (captured as `params["0"]`), and `**` for the rest of the path (`params._`, or `params.name` with `**:name`). Param values are the raw path segments, undecoded.

`RhythmRouter` is not an app and does not extend `Rhythm` — it is a controller that compiles routes and middleware down to a single middleware (`.middleware()`). It shares the core middleware contract (`compose`, `Middleware`, `next(extra)`), but has no `provide()` or `register()`, and it can't be served on its own: a `Rhythm` app is always the host that owns the lifecycle and the adapters.

## Example

```ts
import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmRouter } from "@rhythmjs/router";
import { serve } from "@rhythmjs/router/serve";
import type { RhythmHttpContext } from "@rhythmjs/router/context";

const usersRouter = new RhythmRouter({ prefix: "/users" }).get("/:id", (ctx) => {
  ctx.json({ id: ctx.params.id });
});

const app = new Rhythm<RhythmHttpContext>().use(usersRouter.middleware());
serve(app, { port: 3000 });
```

A fuller runnable version, including nested prefixes and a fallback route, is at [`examples/router`](../../examples/router).

## Concepts

- **`ctx.response`** is a plain mutable object (`status`, `statusText`, `headers`, `body`) — set it directly rather than constructing a `Response` yourself. The adapter converts it to a real `Response` at the end.
- **Response helpers** — `ctx.json(data, status?)`, `ctx.text(body, status?)`, `ctx.html(body, status?)`, `ctx.error(status, message?)`, and `ctx.redirect(url, status = 302)` set the content type, body, and status on `ctx.response` in one call. `error()` defaults the message from the status code (`ctx.error(404)` → `"Not Found"`). They're sugar over `ctx.response`, so mixing both styles is fine, and later writes win.
- **`ctx.params`** — captured `:name` path segments, added once a route matches.
- **Nesting is `.use(child.middleware())`** — a router mounts into another router (or into the app) as a compiled middleware. The mount is opaque, so the parent's prefix is **not** applied to the child's routes: the child carries its own absolute prefix (`new RhythmRouter({ prefix: "/api/users" })`). On a miss the child falls through to `next()`, so the parent's later middleware and routes still run, and the child keeps working standalone.
- **Registration order is execution order** — a `.use()` middleware wraps only the routes registered after it; routes registered before it are untouched, and a matched route that doesn't call `next()` returns without reaching anything registered later. Consecutive routes share one rou3 lookup; an unmatched request falls through, entry by entry, to the outer `next()`.
- **A router is a controller, not a module** — it has no `provide()` or `register()`, and it cannot be `register()`ed into a `Rhythm` app either; `register()` composes `Rhythm` modules only. A router mounts into an app exactly one way: koa-style, via `.use(router.middleware())`.

## API

- `new RhythmRouter(options?)` — `options.prefix`.
- `.get/.post/.put/.patch/.delete(path, ...handlers)` — register a route; `path` may contain `:param` segments.
- `.use(fn)` — plain middleware; it takes only functions, so a nested router mounts as `.use(child.middleware())`.
- `.middleware()` — this router compiled to a plain middleware: the one form that mounts anywhere, into a `Rhythm` app or into another router. Because the compiled form is opaque, the mounting router's prefix is not applied to it — give the child its full prefix.
- `ctx.json/.text/.html(body, status?)`, `ctx.error(status, message?)`, `ctx.redirect(url, status?)` — response helpers built into the context (`createHttpContext` in `@rhythmjs/router/context`).
- `toFetchHandler(app)` — bridges a `Rhythm` app to a Web-standard `(Request) => Promise<Response>` handler.

## Serving

Two primitives turn an app into a server, both coupled to [Bun](https://bun.com) on purpose:

- **`serve(app, options)`** (`@rhythmjs/router/serve`) — starts the app on `Bun.serve` and returns Bun's `Server` (`server.port`, `server.url`, `server.publish`, `server.stop()`).
- **`toFetchHandler(app)`** (`@rhythmjs/router/fetch`) — the raw `(Request) => Promise<Response>` handler, for composing and testing without a listener.

`serve()` passes the server fields through to `Bun.serve` — `port`, `hostname`, `unix`, `tls`, `reusePort`, `idleTimeout`, `development`, `maxRequestBodySize` (an over-limit body is rejected without crashing) — plus the extension points below. Every request gets a lazy `request.ip` (from `server.requestIP()`), the field `@rhythmjs/security`'s rate limit and `@rhythmjs/http`'s proxy key off. Errors thrown in the middleware chain are answered with `500` (or the error's own `status`) without crashing the process; override the mapping with `options.error`.

### Static assets

The `static` option serves files with `Bun.file` before the app runs; a request no folder answers falls through to your routes. It takes one folder config or an array — folders are probed in order, first match wins:

```ts
serve(app, {
  port: 3000,
  static: [{ dir: "dist/client", maxAge: 31536000, immutable: true }, { dir: "public" }],
});
```

Each entry (`StaticMiddlewareOptions`, also exported from `@rhythmjs/router/static`) takes `dir`, `prefix` (mount point, default the site root), `index` (default `index.html`, served for directory paths), `maxAge`/`immutable` cache control, and `ETag` revalidation with `304`s (`etag`, on by default). Content types come from `Bun.file`. Path traversal is normalized away. `middleware` you pass runs before and wraps the static handlers, so CORS or logging cover asset responses too.

### Extending: CORS, WebSockets, and similar

- **`middleware`** — serve middlewares (`(request, next) => Response`) run around the whole app, the natural place for CORS, logging, or auth gates:

  ```ts
  serve(app, {
    middleware: [
      async (request, next) => {
        if (request.method === "OPTIONS")
          return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*" } });
        const response = await next();
        response.headers.set("access-control-allow-origin", "*");
        return response;
      },
    ],
  });
  ```

- **`upgrade` + `websocket`** — the seams for Bun's native WebSockets, shaped for [`@rhythmjs/ws`](https://github.com/rhythmjs/ws). Requests with an `upgrade: websocket` header divert to `upgrade(request, server)` before the app runs (return a `Response` to reject, or `undefined` after `server.upgrade()`); `websocket` is Bun's behavior object, passed through:

  ```ts
  import { websocket } from "@rhythmjs/ws";

  serve(app, { upgrade: ws.upgrade, websocket: websocket() });
  ```

- **`error`** — replace the default error-to-response mapping.

Anything else fetch-shaped composes with the raw primitive: `toFetchHandler(app)` from `@rhythmjs/router/fetch`.
