# @rhythmjs/router

Web-standard HTTP routing on top of `@rhythmjs/rhythm`. `RhythmRouter` matches routes with a compressed radix tree (a static segment always wins over a `:param` segment, regardless of registration order), supports prefixes and nested routers, and mounts flat into a parent `Rhythm` app via `.use(router.routes())`, so an unmatched request correctly falls through to whatever's registered after it.

`RhythmRouter` is not an app and does not extend `Rhythm` — it is a controller that compiles routes and middleware down to a single middleware (`.routes()`). It shares the core middleware contract (`compose`, `Middleware`, `next(extra)`), but has no `provide()` or `register()`, and it can't be served on its own: a `Rhythm` app is always the host that owns the lifecycle and the adapters.

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
- **Prefixes compose across nesting** — a child router mounted into a prefixed parent via `.use(child)` gets the parent's prefix joined onto every one of its routes, at any nesting depth. Mounting copies the child's routes and middleware at that moment; routes added to the child afterwards don't appear in the parent, and the child keeps working standalone.
- **Registration order is execution order** — a `.use()` middleware wraps only the routes registered after it; routes registered before it are untouched, and a matched route that doesn't call `next()` returns without reaching anything registered later. Consecutive routes share one radix tree lookup; an unmatched request falls through, entry by entry, to the outer `next()`.
- **A router is a controller, not a module** — it has no `provide()` or `register()`, and it cannot be `register()`ed into a `Rhythm` app either; `register()` composes `Rhythm` modules only. A router mounts into an app exactly one way: koa-style, via `.use(router.routes())`.

## API

- `new RhythmRouter(options?)` — `options.prefix`.
- `.get/.post/.put/.patch/.delete(path, ...handlers)` — register a route; `path` may contain `:param` segments.
- `.use(fn)` — plain middleware. `.use(child)` — mount a nested `RhythmRouter` (prefixes compose).
- `.routes()` — this router as a plain middleware, for mounting into a `Rhythm` app via `.use()`; the router's only way onto a server. Note: mounting a _router_ into a _router_ must use `.use(child)`, not `.use(child.routes())` — an opaque middleware can't have the parent's prefix applied to its routes.
- `ctx.json/.text/.html(body, status?)`, `ctx.error(status, message?)`, `ctx.redirect(url, status?)` — response helpers built into the context by the adapters (`createHttpContext` in `@rhythmjs/router/context`).
- `toFetchHandler(app)` — bridges a `Rhythm` app to a Web-standard `(Request) => Promise<Response>` handler.

## Serving

Everything above (`RhythmRouter`, `ctx.response`, etc.) is runtime-agnostic. Two primitives turn an app into a server, both built on [srvx](https://srvx.h3.dev):

- **`serve(app, options)`** (`@rhythmjs/router/serve`) — starts a server on Node, Bun, or Deno with one identical call; srvx picks the runtime implementation via conditional exports. On Node, requests are lazy: method, url, headers, and body materialize only when middleware touches them.
- **`toFetchHandler(app)`** (`@rhythmjs/router/fetch`) — the universal `(Request) => Promise<Response>` handler, for platforms that invoke you per request instead of letting you own a listener.

`serve()` accepts every srvx `ServerOptions` field except `fetch`: `port`, `hostname`, `tls` (HTTPS/HTTP2), `maxRequestBodySize` (an over-limit body read is answered with `413`), `reusePort`, `gracefulShutdown`, plus the three extension points below. Errors thrown in the middleware chain are answered with `500` (or the error's own `status`) without crashing the process; override the mapping with `options.error`.

### Extending: CORS, WebSockets, and similar

- **`middleware`** — srvx middlewares (`(request, next) => Response`) run around the whole app, the natural place for CORS, logging, or auth gates:

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

- **`plugins`** — a plugin receives the live srvx `Server`, the hook for anything below fetch, WebSockets included ([crossws](https://crossws.h3.dev) attaches here; on Node the raw server is at `server.node.server`):

  ```ts
  serve(app, { plugins: [(server) => wireWebSockets(server)] });
  ```

- **`error`** — replace the default error-to-response mapping.

## Deploying per runtime

One app definition; each runtime has its own adapter under `@rhythmjs/router/adapters/*`, hono-style: import from your target's adapter and export what the platform expects. Runtimes that speak web-standard `Request`/`Response` natively (Bun, Deno, Vercel) can equally use `toFetchHandler(app)` from `@rhythmjs/router/fetch` — their adapters are aliases for it.

Every adapter maps errors thrown in the middleware chain to a response (`500`, or the error's own `status`) instead of crashing, and accepts `{ onError }` to replace that mapping: `handle(app, { onError: (error) => new Response("down", { status: 503 }) })`. Platform metadata (Cloudflare `env`/`ctx`, the Netlify context) is readable in middleware via `getRuntime(ctx.request)` from `@rhythmjs/router/context`.

**Node** — `getRequestListener` returns a listener for your own `node:http` server:

```ts
import { createServer } from "node:http";
import { getRequestListener } from "@rhythmjs/router/adapters/node";

createServer(getRequestListener(app, { maxRequestBodySize: 1024 * 1024 })).listen(3000);
```

(Or skip the adapter entirely and use `serve(app, { port: 3000 })`.)

**Bun**

```ts
import { handle } from "@rhythmjs/router/adapters/bun";

Bun.serve({ port: 3000, fetch: handle(app) });
```

**Deno**

```ts
import { handle } from "@rhythmjs/router/adapters/deno";

Deno.serve({ port: 3000 }, handle(app));
```

**Vercel** — in a catch-all route file:

```ts
import { handle } from "@rhythmjs/router/adapters/vercel";

const handler = handle(app);
export const GET = handler;
export const POST = handler; // …and the other methods you serve
```

**Cloudflare Workers** — `env` and `ctx` are exposed to middleware as `ctx.request.runtime.cloudflare`:

```ts
import { handle } from "@rhythmjs/router/adapters/cloudflare";

export default { fetch: handle(app) };
```

**AWS Lambda** — API Gateway v1/v2 events, translated by srvx:

```ts
import { handle } from "@rhythmjs/router/adapters/aws-lambda";

export const lambda = handle(app);
```

**Netlify Edge Functions** — the Netlify context is exposed as `ctx.request.runtime.netlify`:

```ts
import { handle } from "@rhythmjs/router/adapters/netlify";

export default handle(app);
export const config = { path: "/*" };
```

**Service workers**

```ts
import { handle } from "@rhythmjs/router/adapters/service-worker";

addEventListener("fetch", handle(app));
```

Any other fetch-based runtime works with the raw primitive: `toFetchHandler(app)` from `@rhythmjs/router/fetch`.
