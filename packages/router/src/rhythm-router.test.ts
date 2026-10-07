import { test, expect } from "bun:test";
import { Pipeline, Rhythm, decorate, derive, mount } from "@rhythmjs/rhythm";
import { RhythmRouter } from "./rhythm-router";
import { createHttpContext, type RhythmHttpContext } from "./context";

type Dyn = Record<string, any>;

async function call(
  router: { callback(): (ctx: any) => Promise<unknown> },
  method: string,
  path: string,
  extra: Record<string, any> = {},
) {
  const req = new Request(`http://localhost${path}`, { method });
  const ctx: Record<string, any> = Object.assign(createHttpContext(req), extra);
  await router.callback()(ctx);
  return ctx;
}

test("each method helper matches only its own HTTP method", async () => {
  const router = new RhythmRouter()
    .get("/thing", (ctx) => ctx.text("get"))
    .post("/thing", (ctx) => ctx.text("post"))
    .put("/thing", (ctx) => ctx.text("put"))
    .patch("/thing", (ctx) => ctx.text("patch"))
    .delete("/thing", (ctx) => ctx.text("delete"));

  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    const ctx = await call(router, method, "/thing");
    expect(ctx.response.body).toBe(method.toLowerCase());
  }
});

test("an unknown method or path leaves the response untouched", async () => {
  const router = new RhythmRouter().get("/thing", (ctx) => {
    ctx.text("ok");
  });

  const wrongMethod = await call(router, "POST", "/thing");
  const wrongPath = await call(router, "GET", "/other");

  for (const ctx of [wrongMethod, wrongPath]) {
    expect(ctx.response.status).toBe(200);
    expect(ctx.response.body).toBeNull();
    expect([...ctx.response.headers]).toEqual([]);
  }
});

test("path params are parsed, decoded and typed", async () => {
  const seen: unknown[] = [];
  const router = new RhythmRouter().get("/orgs/:org/users/:id", (ctx) => {
    const org: string = ctx.params.org;
    const id: string = ctx.params.id;
    seen.push(org, id);
  });

  await call(router, "GET", "/orgs/acme%20inc/users/42");

  expect(seen).toEqual(["acme inc", "42"]);
});

test("a malformed percent-encoded param does not match", async () => {
  const router = new RhythmRouter().get("/users/:id", (ctx) => {
    ctx.text("ok");
  });

  const ctx = await call(router, "GET", "/users/%E0%A4%A");

  expect(ctx.response.body).toBeNull();
});

test("trailing slashes are ignored and segment counts must match", async () => {
  const router = new RhythmRouter()
    .get("/users", (ctx) => ctx.text("list"))
    .get("/users/:id", (ctx) => ctx.text("one"));

  const withSlash = await call(router, "GET", "/users/");
  const tooLong = await call(router, "GET", "/users/1/extra");

  expect(withSlash.response.body).toBe("list");
  expect(tooLong.response.body).toBeNull();
});

test("handlers respond through the ctx helpers and real response values", async () => {
  const router = new RhythmRouter().post("/things", (ctx) => {
    ctx.response.headers.set("x-thing-id", "7");
    ctx.json({ id: 7 }, 201);
  });

  const ctx = await call(router, "POST", "/things");

  expect(ctx.response.status).toBe(201);
  expect(ctx.response.headers.get("x-thing-id")).toBe("7");
  expect(ctx.response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(ctx.response.body).toBe('{"id":7}');
});

test("a handler's return value is ignored", async () => {
  const router = new RhythmRouter().get("/x", () => ({ ignored: true }));

  const ctx = await call(router, "GET", "/x");

  expect(ctx.response.body).toBeNull();
});

test("async handlers are awaited", async () => {
  const router = new RhythmRouter().get("/slow", async (ctx) => {
    await Bun.sleep(10);
    ctx.json({ done: true });
  });

  const ctx = await call(router, "GET", "/slow");

  expect(ctx.response.body).toBe('{"done":true}');
});

test("the most specific route wins, whatever the registration order", async () => {
  const calls: string[] = [];
  const router = new RhythmRouter()
    .get("/users/:id", () => void calls.push("param route"))
    .get("/users/me", () => void calls.push("literal route"));

  await call(router, "GET", "/users/me");
  await call(router, "GET", "/users/42");

  expect(calls).toEqual(["literal route", "param route"]);
});

test("use middleware wraps every route of this router, wherever it was added", async () => {
  const calls: string[] = [];
  const router = new RhythmRouter()
    .get("/x", () => void calls.push("route x"))
    .use(async (_ctx, next) => {
      calls.push("in");
      await next();
      calls.push("out");
    })
    .get("/y", () => void calls.push("route y"));

  await call(router, "GET", "/x");
  await call(router, "GET", "/y");

  expect(calls).toEqual(["in", "route x", "out", "in", "route y", "out"]);
});

test("use middleware does not run when no route of this router matches", async () => {
  const calls: string[] = [];
  const router = new RhythmRouter()
    .use(async (_ctx, next) => {
      calls.push("middleware");
      await next();
    })
    .get("/x", () => void calls.push("route"));

  await call(router, "GET", "/missing");
  await call(router, "POST", "/x");
  await call(router, "GET", "/x/extra");

  expect(calls).toEqual([]);
});

test("use middleware can read the matched params", async () => {
  const seen: unknown[] = [];
  const router = new RhythmRouter()
    .use(async (ctx, next) => {
      seen.push(ctx.params.id);
      await next();
    })
    .get("/users/:id", () => {});

  await call(router, "GET", "/users/42");

  expect(seen).toEqual(["42"]);
});

test("with several routers mounted, only the one that owns the route runs its middleware", async () => {
  const calls: string[] = [];
  const users = new RhythmRouter()
    .use(async (_ctx, next) => {
      calls.push("users middleware");
      await next();
    })
    .get("/users", (ctx) => ctx.text("users"));
  const posts = new RhythmRouter()
    .use(async (_ctx, next) => {
      calls.push("posts middleware");
      await next();
    })
    .get("/posts", (ctx) => ctx.text("posts"));

  const app = new Rhythm().use(mount(users)).use(mount(posts));

  const usersCtx = createHttpContext(new Request("http://localhost/users"));
  await app.callback()(usersCtx);
  const postsCtx = createHttpContext(new Request("http://localhost/posts"));
  await app.callback()(postsCtx);
  const otherCtx = createHttpContext(new Request("http://localhost/other"));
  await app.callback()(otherCtx);

  expect(calls).toEqual(["users middleware", "posts middleware"]);
  expect(usersCtx.response.body).toBe("users");
  expect(postsCtx.response.body).toBe("posts");
  expect(otherCtx.response.body).toBeNull();
});

test("use middleware that skips next() stops route dispatch", async () => {
  const router = new RhythmRouter()
    .use((ctx) => {
      ctx.error(403, "blocked");
    })
    .get("/x", (ctx) => ctx.text("never"));

  const ctx = await call(router, "GET", "/x");

  expect(ctx.response.status).toBe(403);
  expect(ctx.response.body).toBe("blocked");
});

test("route handlers form a middleware chain", async () => {
  const calls: string[] = [];
  const router = new RhythmRouter<Dyn>().get(
    "/x",
    async (_ctx, next) => {
      calls.push("first in");
      await next();
      calls.push("first out");
    },
    async (ctx, next) => {
      calls.push("second");
      ctx.seen = "by second";
      await next();
    },
    (ctx) => {
      calls.push("last");
      ctx.json({ seen: ctx.seen });
    },
  );

  const ctx = await call(router, "GET", "/x");

  expect(calls).toEqual(["first in", "second", "last", "first out"]);
  expect(ctx.response.body).toBe('{"seen":"by second"}');
});

test("a route middleware can short-circuit by not calling next()", async () => {
  const calls: string[] = [];
  const router = new RhythmRouter().get(
    "/secret",
    (ctx, next) => {
      calls.push("auth");
      if (!ctx.request.headers.has("authorization")) {
        ctx.error(401);
        return;
      }
      return next();
    },
    (ctx) => {
      calls.push("handler");
      ctx.text("secret");
    },
  );

  const denied = await call(router, "GET", "/secret");

  expect(denied.response.status).toBe(401);
  expect(denied.response.body).toBe("Unauthorized");
  expect(calls).toEqual(["auth"]);
});

test("route middleware only runs for its own route", async () => {
  const calls: string[] = [];
  const guard = async (_ctx: unknown, next: () => Promise<void>) => {
    calls.push("guard");
    await next();
  };
  const router = new RhythmRouter()
    .get("/guarded", guard, (ctx) => ctx.text("guarded"))
    .get("/open", (ctx) => ctx.text("open"));

  await call(router, "GET", "/open");
  await call(router, "GET", "/guarded");

  expect(calls).toEqual(["guard"]);
});

test("rou3 patterns: optional params, wildcards and catch-alls", async () => {
  const router = new RhythmRouter()
    .get("/posts/:id/:tab?", (ctx) => {
      const id: string = ctx.params.id;
      const tab: string | undefined = ctx.params.tab;
      ctx.json({ id, tab });
    })
    .get("/files/**:path", (ctx) => {
      ctx.json({ path: ctx.params.path });
    });

  const withTab = await call(router, "GET", "/posts/7/comments");
  const withoutTab = await call(router, "GET", "/posts/7");
  const deep = await call(router, "GET", "/files/a/b/c.txt");

  expect(JSON.parse(withTab.response.body)).toEqual({ id: "7", tab: "comments" });
  expect(JSON.parse(withoutTab.response.body)).toEqual({ id: "7" });
  expect(JSON.parse(deep.response.body)).toEqual({ path: "a/b/c.txt" });
});

test("use with derive widens the ctx type for later routes", async () => {
  const router = new RhythmRouter().use(derive(() => ({ user: "ada" }))).get("/me", (ctx) => {
    const user: string = ctx.user;
    ctx.json({ user });
  });

  const ctx = await call(router, "GET", "/me");

  expect(ctx.response.body).toBe('{"user":"ada"}');
});

test("a mounted router sets the response on the parent's ctx and sees its values", async () => {
  const api = new RhythmRouter<{ appName: string }>().get("/hello", (ctx) => {
    ctx.text(`hello from ${ctx.appName}`);
  });

  const app = new Rhythm().register(decorate(() => ({ appName: "rhythm" }))).use(mount(api));
  const ctx = createHttpContext(new Request("http://localhost/hello"));
  await app.callback()(ctx);

  expect(ctx.response.body).toBe("hello from rhythm");
});

test("an unmatched mounted router falls through to the parent's later middleware", async () => {
  const api = new RhythmRouter().get("/hello", (ctx) => {
    ctx.text("api");
  });

  const app = new Rhythm<{}, RhythmHttpContext>().use(mount(api)).use(async (ctx, next) => {
    if (ctx.response.body === null) {
      ctx.error(404, "fallback");
    }
    await next();
  });

  const ctx = createHttpContext(new Request("http://localhost/nope"));
  await app.callback()(ctx);

  expect(ctx.response.status).toBe(404);
  expect(ctx.response.body).toBe("fallback");
});

test("mount can scope a router with its condition", async () => {
  const api = new RhythmRouter().get("/api/ping", (ctx) => {
    ctx.text("pong");
  });

  const app = new Rhythm<{}, RhythmHttpContext>().use(
    mount(api, (ctx) => new URL(ctx.request.url).pathname.startsWith("/api")),
  );

  const hit = createHttpContext(new Request("http://localhost/api/ping"));
  const miss = createHttpContext(new Request("http://localhost/ping"));
  await app.callback()(hit);
  await app.callback()(miss);

  expect(hit.response.body).toBe("pong");
  expect(miss.response.body).toBeNull();
});

test("a router can be mounted from a catch-all route of another router", async () => {
  const inner = new RhythmRouter().get("/api/deep", (ctx) => {
    ctx.text("inner");
  });
  const outer = new RhythmRouter().get("/api/**", mount(inner));

  const ctx = await call(outer, "GET", "/api/deep");

  expect(ctx.response.body).toBe("inner");
});

test("mounting a router with use() on a router without routes does nothing", async () => {
  const inner = new RhythmRouter().get("/deep", (ctx) => {
    ctx.text("inner");
  });
  const outer = new RhythmRouter().use(mount(inner));

  const ctx = await call(outer, "GET", "/deep");

  expect(ctx.response.body).toBeNull();
});

test("derive as the first route handler widens the ctx type for the handlers after it", async () => {
  const router = new RhythmRouter().get(
    "/me",
    derive(() => ({ user: "ada" })),
    (ctx) => {
      const user: string = ctx.user;
      ctx.json({ user });
    },
  );

  const ctx = await call(router, "GET", "/me");

  expect(ctx.response.body).toBe('{"user":"ada"}');
});

test("derived route values are precisely typed, not any", () => {
  new RhythmRouter().get(
    "/me",
    derive(() => ({ user: "ada", visits: 3 })),
    (ctx) => {
      const visits: number = ctx.visits;
      // @ts-expect-error
      const wrong: number = ctx.user;
      return [visits, wrong];
    },
  );
});

test("a route derive can read params and the request", async () => {
  const router = new RhythmRouter().get(
    "/users/:id",
    derive((ctx) => ({
      id: Number(ctx.params.id),
      method: ctx.request.method,
    })),
    (ctx) => {
      const id: number = ctx.id;
      ctx.json({ id, method: ctx.method });
    },
  );

  const ctx = await call(router, "GET", "/users/42");

  expect(ctx.response.body).toBe('{"id":42,"method":"GET"}');
});

test("an async route derive is awaited and typed by its resolved value", async () => {
  const router = new RhythmRouter().get(
    "/x",
    derive(async () => ({ token: await Promise.resolve("abc") })),
    (ctx) => {
      const token: string = ctx.token;
      ctx.text(token);
    },
  );

  const ctx = await call(router, "GET", "/x");

  expect(ctx.response.body).toBe("abc");
});

test("route derive works with further middleware and every verb", async () => {
  const calls: string[] = [];
  const router = new RhythmRouter()
    .post(
      "/a",
      derive(() => ({ n: 1 })),
      (_ctx, next) => {
        calls.push("mw");
        return next();
      },
      (ctx) => void calls.push(`post:${ctx.n}`),
    )
    .put(
      "/a",
      derive(() => ({ n: 2 })),
      (ctx) => void calls.push(`put:${ctx.n}`),
    )
    .patch(
      "/a",
      derive(() => ({ n: 3 })),
      (ctx) => void calls.push(`patch:${ctx.n}`),
    )
    .delete(
      "/a",
      derive(() => ({ n: 4 })),
      (ctx) => void calls.push(`delete:${ctx.n}`),
    );

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    await call(router, method, "/a");
  }

  expect(calls).toEqual(["mw", "post:1", "put:2", "patch:3", "delete:4"]);
});

test("a route derive only applies to its own route", async () => {
  const seen: unknown[] = [];
  const router = new RhythmRouter()
    .get(
      "/with",
      derive(() => ({ extra: "yes" })),
      (ctx) => void seen.push(ctx.extra),
    )
    // @ts-expect-error `extra` is only derived for /with
    .get("/without", (ctx) => void seen.push(ctx.extra));

  await call(router, "GET", "/with");
  await call(router, "GET", "/without");

  expect(seen).toEqual(["yes", undefined]);
});

test("RhythmRouter is a Pipeline", () => {
  expect(new RhythmRouter()).toBeInstanceOf(Pipeline);
});

test("rejects a route path that does not start with a slash", () => {
  expect(() => new RhythmRouter().get("users", () => {})).toThrow(TypeError);
});
