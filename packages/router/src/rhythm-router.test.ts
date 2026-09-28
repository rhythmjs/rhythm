import { describe, expect, test } from "vite-plus/test";
import { Rhythm } from "@rhythmjs/rhythm";
import { toFetchHandler } from "./adapters/bun";
import type { RhythmHttpContext } from "./adapters/context";
import { RhythmRouter } from "./rhythm-router";

const serve = (router: RhythmRouter<any>) => toFetchHandler(new Rhythm<RhythmHttpContext>().use(router.routes()));

describe("RhythmRouter", () => {
  test("matches method + path and extracts named params", async () => {
    const router = new RhythmRouter().get("/users/:id", (ctx) => {
      ctx.response.body = `user ${ctx.params.id}`;
    });

    const res = await serve(router)(new Request("http://localhost/users/42"));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("user 42");
  });

  test("a static segment always wins over a param segment, regardless of registration order", async () => {
    const router = new RhythmRouter()
      .get("/users/:id", (ctx) => {
        ctx.response.body = `param:${ctx.params.id}`;
      })
      .get("/users/active", (ctx) => {
        ctx.response.body = "static";
      });

    const res = await serve(router)(new Request("http://localhost/users/active"));
    expect(await res.text()).toBe("static");

    const paramRes = await serve(router)(new Request("http://localhost/users/42"));
    expect(await paramRes.text()).toBe("param:42");
  });

  test("falls through to next() when the method doesn't match", async () => {
    const router = new RhythmRouter()
      .get("/ping", (ctx) => {
        ctx.response.body = "get";
      })
      .post("/ping", (ctx) => {
        ctx.response.body = "post";
      });

    const res = await serve(router)(new Request("http://localhost/ping", { method: "POST" }));

    expect(await res.text()).toBe("post");
  });

  test("falls through to next() when the path doesn't match, leaving the response as-is", async () => {
    const router = new RhythmRouter().get("/known", (ctx) => {
      ctx.response.body = "known";
    });

    const res = await serve(router)(new Request("http://localhost/unknown"));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  test("multiple handlers per route compose in onion order", async () => {
    const events: string[] = [];
    const router = new RhythmRouter().get(
      "/users/:id",
      async (ctx, next) => {
        events.push("auth:before");
        await next();
        events.push("auth:after");
      },
      (ctx) => {
        events.push(`handler:${ctx.params.id}`);
        ctx.response.body = "ok";
      },
    );

    await serve(router)(new Request("http://localhost/users/7"));

    expect(events).toEqual(["auth:before", "handler:7", "auth:after"]);
  });

  test("a route middleware extends the context for later handlers via next(extra)", async () => {
    const router = new RhythmRouter().get<{ user?: { name: string } }>(
      "/users/:id",
      async (ctx, next) => {
        await next({ user: { name: `user-${ctx.params.id}` } });
      },
      (ctx) => {
        ctx.response.body = ctx.user?.name ?? "missing";
      },
    );

    const res = await serve(router)(new Request("http://localhost/users/7"));

    expect(await res.text()).toBe("user-7");
  });

  test("registration order is execution order - use() after a route doesn't wrap that route", async () => {
    const events: string[] = [];
    const router = new RhythmRouter()
      .get("/ping", (ctx) => {
        events.push("route");
        ctx.response.body = "ok";
      })
      .use(async (ctx, next) => {
        events.push("late-middleware");
        await next();
      });

    await serve(router)(new Request("http://localhost/ping"));

    expect(events).toEqual(["route"]);
  });

  test("a middleware between two routes wraps only the route registered after it", async () => {
    const events: string[] = [];
    const router = new RhythmRouter()
      .get("/early", (ctx) => {
        events.push("early");
        ctx.response.body = "early";
      })
      .use(async (ctx, next) => {
        events.push("middleware");
        await next();
      })
      .get("/late", (ctx) => {
        events.push("late");
        ctx.response.body = "late";
      });

    await serve(router)(new Request("http://localhost/early"));
    await serve(router)(new Request("http://localhost/late"));

    expect(events).toEqual(["early", "middleware", "late"]);
  });

  describe("prefix", () => {
    test("routes are matched under the configured prefix", async () => {
      const router = new RhythmRouter({ prefix: "/api" }).get("/users/:id", (ctx) => {
        ctx.response.body = ctx.params.id;
      });

      const handler = serve(router);

      const prefixed = await handler(new Request("http://localhost/api/users/5"));
      expect(await prefixed.text()).toBe("5");

      const unprefixed = await handler(new Request("http://localhost/users/5"));
      expect(unprefixed.status).toBe(200);
      expect(await unprefixed.text()).toBe("");
    });

    test("normalizes a trailing slash on the prefix and a missing leading slash on the path", async () => {
      const router = new RhythmRouter({ prefix: "/api/" }).get("users/:id", (ctx) => {
        ctx.response.body = ctx.params.id;
      });

      const res = await serve(router)(new Request("http://localhost/api/users/9"));
      expect(await res.text()).toBe("9");
    });

    test("a parent router's prefix applies to a child router mounted via use(child)", async () => {
      const usersRouter = new RhythmRouter().get("/users/:id", (ctx) => {
        ctx.response.body = ctx.params.id;
      });

      const apiRouter = new RhythmRouter({ prefix: "/api" }).use(usersRouter);

      const handler = serve(apiRouter);

      const prefixed = await handler(new Request("http://localhost/api/users/5"));
      expect(await prefixed.text()).toBe("5");

      const unprefixed = await handler(new Request("http://localhost/users/5"));
      expect(unprefixed.status).toBe(200);
      expect(await unprefixed.text()).toBe("");
    });

    test("prefixes compose across multiple levels of nesting", async () => {
      const usersRouter = new RhythmRouter().get("/users/:id", (ctx) => {
        ctx.response.body = ctx.params.id;
      });

      const v1Router = new RhythmRouter({ prefix: "/v1" }).use(usersRouter);
      const apiRouter = new RhythmRouter({ prefix: "/api" }).use(v1Router);

      const res = await serve(apiRouter)(new Request("http://localhost/api/v1/users/7"));
      expect(await res.text()).toBe("7");
    });

    test("mounting a child router doesn't mutate the child's own standalone prefix", async () => {
      const usersRouter = new RhythmRouter().get("/users/:id", (ctx) => {
        ctx.response.body = ctx.params.id;
      });

      new RhythmRouter({ prefix: "/api" }).use(usersRouter);

      const res = await serve(usersRouter)(new Request("http://localhost/users/5"));
      expect(await res.text()).toBe("5");
    });
  });

  describe("routes(), mounted via a parent's use() (koa-style)", () => {
    test("a matched route that doesn't call next() short-circuits the parent app's downstream middleware", async () => {
      const router = new RhythmRouter().get("/hello", (ctx) => {
        ctx.response.body = "router";
      });

      const app = new Rhythm<RhythmHttpContext>().use(router.routes()).use((ctx) => {
        ctx.response.status = 404;
        ctx.response.body = "Not Found";
      });

      const res = await toFetchHandler(app)(new Request("http://localhost/hello"));

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("router");
    });

    test("an unmatched request falls all the way through to the parent app's downstream middleware", async () => {
      const router = new RhythmRouter().get("/hello", (ctx) => {
        ctx.response.body = "router";
      });

      const app = new Rhythm<RhythmHttpContext>().use(router.routes()).use((ctx) => {
        ctx.response.status = 404;
        ctx.response.body = "Not Found";
      });

      const res = await toFetchHandler(app)(new Request("http://localhost/unmatched"));

      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not Found");
    });

    test("a route that explicitly calls next() still lets the parent's downstream middleware run", async () => {
      const router = new RhythmRouter().get("/hello", async (ctx, next) => {
        ctx.response.body = "router";
        await next();
      });

      const app = new Rhythm<RhythmHttpContext>().use(router.routes()).use((ctx) => {
        ctx.response.headers.set("x-app", "seen");
      });

      const res = await toFetchHandler(app)(new Request("http://localhost/hello"));

      expect(await res.text()).toBe("router");
      expect(res.headers.get("x-app")).toBe("seen");
    });
  });

  test("a router is a controller, not a module - it exposes no register() or provide()", () => {
    const router = new RhythmRouter();

    expect("register" in router).toBe(false);
    expect("provide" in router).toBe(false);
  });
});
