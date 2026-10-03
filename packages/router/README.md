# @rhythmjs/router

The HTTP layer of Rhythm, the Bun-native backend framework: web-standard (`Request`/`Response`) routing on top of the `@rhythmjs/rhythm` kernel, served on `Bun.serve`. `RhythmRouter` matches routes with [rou3](https://github.com/h3js/rou3), the router that powers h3 (a static segment always wins over a `:param` segment, regardless of registration order), supports prefixes and nested routers, and mounts flat into a parent `Rhythm` app via `.use(router.middleware())`, so an unmatched request correctly falls through to whatever's registered after it.

Route patterns follow rou3's conventions: `:name` params (`:name?` optional, `:id(\\d+)` regex-constrained), `*` for one unnamed segment (captured as `params["0"]`), and `**` for the rest of the path (`params._`, or `params.name` with `**:name`). Param values are the raw path segments, undecoded.

`RhythmRouter` is not an app and does not extend `Rhythm`; it is a controller that compiles routes and middleware down to a single middleware (`.middleware()`). It shares the core middleware contract (`compose`, `Middleware`, `derive`; `next()` takes no arguments, extend the context with `derive()`), but has no a startup `context` or `register()`, and it can't be served on its own: a `Rhythm` app is always the host that owns the lifecycle and the adapters.

## Example

```ts
import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmRouter } from "@rhythmjs/router";
import { toFetchHandler } from "@rhythmjs/router/fetch";
import type { RhythmHttpContext } from "@rhythmjs/router/context";

const usersRouter = new RhythmRouter({ prefix: "/users" }).get("/:id", (ctx) => {
  ctx.json({ id: ctx.params.id });
});

const app = new Rhythm<RhythmHttpContext>().use(usersRouter.middleware());
Bun.serve({ port: 3000, fetch: toFetchHandler(app) });
```

A fuller runnable version, including nested prefixes and a fallback route, is at [`examples/router`](../../examples/router).

## Concepts

- **`ctx.response`** is a plain mutable object (`status`, `statusText`, `headers`, `body`): set it directly rather than constructing a `Response` yourself. The adapter converts it to a real `Response` at the end.
- **Response helpers**: `ctx.json(data, status?)`, `ctx.text(body, status?)`, `ctx.html(body, status?)`, `ctx.error(status, message?)`, and `ctx.redirect(url, status = 302)` (status must be 301, 302, 303, 307 or 308; the URL is used as given, so never pass a user-supplied `next`/`returnTo` value without checking it against an allowlist or requiring a same-origin path) set the content type, body, and status on `ctx.response` in one call. `error()` defaults the message from the status code (`ctx.error(404)` → `"Not Found"`). They're sugar over `ctx.response`, so mixing both styles is fine, and later writes win.
- **`ctx.params`**: captured `:name` path segments, added once a route matches.
- **Nesting is `.use(child.middleware())`**: a router mounts into another router (or into the app) as a compiled middleware. The mount is opaque, so the parent's prefix is **not** applied to the child's routes: the child carries its own absolute prefix (`new RhythmRouter({ prefix: "/api/users" })`). On a miss the child falls through to `next()`, so the parent's later middleware and routes still run, and the child keeps working standalone.
- **Registration order is execution order**: a `.use()` middleware wraps only the routes registered after it, and runs only when one of them matches the request's method and path (so a guard in a `/projects` router never answers `/docs`); a mounted router (`.use(child.middleware())`) always runs; routes registered before it are untouched, and a matched route that doesn't call `next()` returns without reaching anything registered later. Consecutive routes share one rou3 lookup; an unmatched request falls through, entry by entry, to the outer `next()`.
- **A router is a controller, not a module**: it has no a startup `context` or `register()`, and it cannot be `register()`ed into a `Rhythm` app either; `register()` composes `Rhythm` modules only. A router mounts into an app exactly one way: koa-style, via `.use(router.middleware())`.

## API

- `new RhythmRouter(options?)`: `options.prefix`.
- `.get/.post/.put/.patch/.delete(path, ...handlers)`: register a route; `path` may contain `:param` segments.
- `.use(fn)`: plain middleware; it takes only functions, so a nested router mounts as `.use(child.middleware())`.
- `.middleware()`: this router compiled to a plain middleware: the one form that mounts anywhere, into a `Rhythm` app or into another router. Because the compiled form is opaque, the mounting router's prefix is not applied to it, so give the child its full prefix.
- `.entries`: a read-only snapshot of registered middlewares and routes, in order. `.middleware()` is tagged with the router as its source, so a parent module lists it in `sources`.
- `ctx.json/.text/.html(body, status?)`, `ctx.error(status, message?)`, `ctx.redirect(url, status?)`: response helpers built into the context (`createHttpContext` in `@rhythmjs/router/context`).
- `toFetchHandler(app)`: bridges a `Rhythm` app to a Web-standard `(Request) => Promise<Response>` handler.

## Serving: your Bun.serve, no wrapper

There is no `serve()` helper and no static-file helper. You write `Bun.serve` in your own `main.ts`, and the package gives you exactly two plain pieces for its `fetch`:

- **`toFetchHandler(app)`** (`@rhythmjs/router/fetch`): the app as a `(Request) => Promise<Response>` handler.
- **`errorToResponse(error)`** (`@rhythmjs/router/fetch`): maps a thrown error to a Response: the error's own `status`/`statusCode` when it is an integer in 400-599 (its message is the body, unless the error sets `expose: false`, which sends the generic status text instead), else a logged `500`.

Everything wired, explicitly:

```ts
import { toFetchHandler, errorToResponse } from "@rhythmjs/router/fetch";

const handler = toFetchHandler(app);

const server = Bun.serve({
  port: 3000,
  async fetch(request, srv) {
    // Optional: expose the client address as request.ip, the field
    // @rhythmjs/security's rate limit and @rhythmjs/http's proxy key off.
    Object.defineProperty(request, "ip", {
      configurable: true,
      get: () => srv.requestIP(request)?.address,
    });
    try {
      return await handler(request);
    } catch (error) {
      return errorToResponse(error);
    }
  },
});
```

Since `Bun.serve` is yours, all of Bun's server options (`port`, `hostname`, `unix`, `tls`, `idleTimeout`, `maxRequestBodySize`, `reusePort`, `development`, …) and the `Server` itself (`server.url`, `server.publish`, `server.stop()`) are used directly; nothing is proxied or renamed.

### Static files

Use Bun's built-in `routes`; there is nothing to import:

```ts
const server = Bun.serve({
  routes: {
    "/": new Response(Bun.file("public/index.html")), // one known file
    "/static/*": { dir: "./public" }, // a whole folder
  },
  fetch: toFetchHandler(app), // everything else is the app
});
```

Directory routes (`{ dir }`, path must end in `/*`) come with content types, `Last-Modified` + weak `ETag` with `304` revalidation, `Range` requests, `index.html` for trailing-slash requests (and a `301` to add the slash), and `404` for missing or non-canonical (traversal) paths.

> **Warning: never mount a directory at `"/*"`.** A directory route answers its own `404`s: with `"/*": { dir }`, every URL that isn't a file dies there and your app's `fetch` never runs. Keep folders on dedicated prefixes (`/static/*`, `/assets/*`) and let `fetch` stay the app's. For root-level files (favicon, robots.txt), map each one explicitly: `"/favicon.svg": new Response(Bun.file("public/favicon.svg"))`.

### WebSockets

[`@rhythmjs/ws`](https://github.com/rhythmjs/ws) plugs into the same hand-wired `fetch`: its `upgrade()` returns `null` synchronously for non-websocket requests, so it composes as `ws.upgrade(request, srv) ?? handler(request)`, with `websocket: ws.websocket` on the same `Bun.serve` call.
