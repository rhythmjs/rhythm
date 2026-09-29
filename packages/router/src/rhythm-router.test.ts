import { describe, expect, test } from "vite-plus/test";
import { Rhythm } from "@rhythmjs/rhythm";
import type { DeriveMiddleware, Middleware } from "@rhythmjs/rhythm/types";
import { toFetchHandler } from "./adapters/web-std";
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

  test("a route middleware can guard without extending - next() is pure koa style", async () => {
    const router = new RhythmRouter().get(
      "/users/:id",
      async (ctx, next) => {
        if (ctx.params.id === "0") {
          ctx.response.status = 403;
          return;
        }
        await next();
      },
      (ctx) => {
        ctx.response.body = `user-${ctx.params.id}`;
      },
    );

    const res = await serve(router)(new Request("http://localhost/users/7"));
    expect(await res.text()).toBe("user-7");

    const denied = await serve(router)(new Request("http://localhost/users/0"));
    expect(denied.status).toBe(403);
  });

  test("response helpers work inside route handlers end to end", async () => {
    const router = new RhythmRouter()
      .get("/users/:id", (ctx) => {
        ctx.json({ id: ctx.params.id }, 201);
      })
      .get("/gone", (ctx) => {
        ctx.error(410);
      })
      .get("/old", (ctx) => {
        ctx.redirect("/users/1", 301);
      });

    const handler = serve(router);

    const json = await handler(new Request("http://localhost/users/7"));
    expect(json.status).toBe(201);
    expect(json.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await json.json()).toEqual({ id: "7" });

    const gone = await handler(new Request("http://localhost/gone"));
    expect(gone.status).toBe(410);
    expect(await gone.text()).toBe("Gone");

    const redirect = await handler(new Request("http://localhost/old", { redirect: "manual" }));
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("location")).toBe("/users/1");
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

  describe("derived context", () => {
    type UserContext = { user: { name: string } };

    test("context derived by middleware reaches route handlers on a typed router", async () => {
      const withUser: Middleware<RhythmHttpContext & Partial<UserContext>> = async (ctx, next) => {
        ctx.user = { name: "Ada" };
        await next();
      };

      const router = new RhythmRouter<RhythmHttpContext & UserContext>().use(withUser).get("/me", (ctx) => {
        ctx.response.body = `hi ${ctx.user.name} at ${ctx.params.id ?? "root"}`;
      });

      const res = await serve(router)(new Request("http://localhost/me"));

      expect(await res.text()).toBe("hi Ada at root");
    });

    test("use() with a derive-branded middleware widens the context for later routes, like Rhythm.use()", async () => {
      const attach = <TExtra extends object>(extra: TExtra): DeriveMiddleware<RhythmHttpContext, TExtra> => {
        const middleware: Middleware<RhythmHttpContext> = async (ctx, next) => {
          Object.assign(ctx, extra);
          await next();
        };
        return middleware as DeriveMiddleware<RhythmHttpContext, TExtra>;
      };

      const router = new RhythmRouter()
        .use(attach({ user: { name: "Lin" } }))
        .use(attach({ trace: "abc" }))
        .get("/hello", (ctx) => {
          ctx.response.body = `hi ${ctx.user.name} (${ctx.trace})`;
        });

      const res = await serve(router)(new Request("http://localhost/hello"));

      expect(await res.text()).toBe("hi Lin (abc)");
    });

    test("context derived inside a route's own middleware chain reaches later handlers", async () => {
      const withUser: Middleware<RhythmHttpContext & Partial<UserContext>> = async (ctx, next) => {
        ctx.user = { name: "Grace" };
        await next();
      };

      const router = new RhythmRouter<RhythmHttpContext & UserContext>().get("/whoami", withUser, (ctx) => {
        ctx.response.body = ctx.user.name;
      });

      const res = await serve(router)(new Request("http://localhost/whoami"));

      expect(await res.text()).toBe("Grace");
    });
  });

  test("a router is a controller, not a module - it exposes no register() or provide()", () => {
    const router = new RhythmRouter();

    expect("register" in router).toBe(false);
    expect("provide" in router).toBe(false);
  });
});
