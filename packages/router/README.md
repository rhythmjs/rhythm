# @rhythmjs/router

The HTTP layer of Rhythm, the Bun-native backend framework: web-standard (`Request`/`Response`) routing on top of the `@rhythmjs/rhythm` kernel, served on `Bun.serve`. `RhythmRouter` matches routes with [rou3](https://github.com/h3js/rou3), the router that powers h3 (a static segment always wins over a `:param` segment, regardless of registration order).

Route patterns follow rou3's conventions: `:name` params (`:name?` optional, `:id(\\d+)` regex-constrained), `*` for one unnamed segment (captured as `params["0"]`), and `**` for the rest of the path (`params._`, or `params.name` with `**:name`). Param values are URI-decoded; a malformed escape does not match.

`RhythmRouter` is a `Pipeline`, like `Rhythm`: it has request-time `use()` middleware and routes, but no startup phase. Startup work (`register`, `decorate`, `include`) belongs to the `Rhythm` app that mounts it with `mount(router)`.

## Example

```ts
import { Rhythm, decorate, derive, mount } from "@rhythmjs/rhythm";
import { RhythmRouter } from "@rhythmjs/router";
import { toFetchHandler } from "@rhythmjs/router/fetch";

const users = new RhythmRouter({ name: "users" })
  .get("/users/:id", (ctx) => ctx.json({ id: ctx.params.id }))
  .post(
    "/users",
    derive(async (ctx) => ({ body: await ctx.request.json() })),
    (ctx) => ctx.json(ctx.body, 201),
  );

const app = new Rhythm()
  .register(decorate(() => ({ startedAt: Date.now() })))
  .use(derive(() => ({ requestId: crypto.randomUUID() })))
  .use(mount(users));

Bun.serve({ port: 3000, fetch: toFetchHandler(app) });
```

## Concepts

- **Mounting.** A router mounts into a `Rhythm` app (or into another router) with `mount(router)`. After the router handles a request, the parent continues with `next()`, so later middleware still runs; check `ctx.params` or the response state if it should only act on unmatched requests. Give each router its full paths (there is no prefix option); to mount conditionally pass a second argument: `mount(router, (ctx) => ...)`.
- **Request-time only.** `router.use(middleware)` wraps the router's routes and runs only when one of them matches the method and path, so a guard in one router never answers another's requests. Startup values live on the parent app's context and are on every request.
- **`derive` as a route handler.** `derive(fn)` can be the first handler of a route (or `use()`), and widens the context type for the handlers after it.
- **`ctx.response`** is a plain mutable object (`status`, `statusText`, `headers`, `body`): set it directly rather than constructing a `Response` yourself. `toFetchHandler` converts it to a real `Response` at the end, and answers `404` if nothing touched it.
- **Response helpers**: `ctx.json(data, status?)`, `ctx.text(body, status?)`, `ctx.html(body, status?)`, `ctx.error(status, message?)`, and `ctx.redirect(url, status = 302)` (status must be 301, 302, 303, 307 or 308; the URL is used as given, so never pass a user-supplied `next`/`returnTo` value without checking it against an allowlist or requiring a same-origin path) set the content type, body, and status on `ctx.response` in one call. `error()` defaults the message from the status code (`ctx.error(404)` is `"Not Found"`). They're sugar over `ctx.response`, so mixing both styles is fine, and later writes win.
- **`ctx.params`**: captured path params, typed from the path: `/users/:id` gives `params.id: string`, `:id?` is `string | undefined`, and reading a name that is not in the path is a compile error. In `use()` middleware, params are an untyped `Record<string, string>`, since several routes may match.
- **Strict context.** Like `Rhythm`, the route context only has what was added: `ctx.nope` is a compile error, and `derive()` (router-level or as a route's first handler) is how you widen it. A route-level `derive` only affects that route.
- **Apps and the fetch handler.** Inside an app's own middleware, `ctx.request`/`ctx.response` are typed only if the app declares them as input: `new Rhythm<{}, RhythmHttpContext>()`. `toFetchHandler(app)` rejects, at compile time, an app that requires any other input.
- **Errors.** A route that throws makes the handler reject; mounted plugins wrap failures as `mounted router "name" failed` with the original as `cause`. `errorToResponse` looks through the `cause` chain for a declared status.

## API

- `new RhythmRouter<I, D>(options?)`: `I` is context the router needs from the parent (checked by `mount()`), `D` is what its own `derive()` calls add; both are usually inferred. `options.name` labels failures (`type` defaults to `"router"`).
- `.get/.post/.put/.patch/.delete(path, ...handlers)`: register a route; handlers are `(ctx, next)` middleware, and the first may be `derive()`.
- `.use(middleware)`: router-level middleware; `derive()` extends the context type.
- `.callback()`: the router as a `(ctx) => Promise<ctx>` function, used by `mount()` and `toFetchHandler()`.
- `.sources` / `.parent` / `.options`: inherited from `Pipeline`.
- `createHttpContext(request)` / `toResponse(response)` (`@rhythmjs/router/context`): the request context and its conversion to a `Response`.
- `toFetchHandler(app)` (`@rhythmjs/router/fetch`): bridges a `Rhythm` app (or router) to a Web-standard `(Request) => Promise<Response>` handler. Errors reject.
- `errorToResponse(error)` (`@rhythmjs/router/fetch`): maps a thrown error to a `Response`.

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
