import { describe, expect, test } from "bun:test";
import { derive, Rhythm } from "@rhythmjs/rhythm";
import type { RhythmHttpContext } from "./context";
import { toFetchHandler } from "./fetch";
import { matches, routed } from "./match";
import { RhythmRouter } from "./rhythm-router";

const get = (handler: (r: Request) => Promise<Response>, path: string, method = "GET") =>
  handler(new Request(`http://localhost${path}`, { method }));

const ctxFor = (path: string, method = "GET") => ({ request: new Request(`http://localhost${path}`, { method }) });

describe("RhythmRouter#use(fn, condition)", () => {
  test("runs the middleware only when the predicate AND a later route match", async () => {
    const seen: string[] = [];
    const router = new RhythmRouter()
      .use(
        async (ctx, next) => {
          seen.push(`mw ${ctx.request.method} ${new URL(ctx.request.url).pathname}`);
          await next();
        },
        (ctx) => ctx.request.method !== "GET",
      )
      .get("/a", (ctx) => ctx.text("get a"))
      .post("/a", (ctx) => ctx.text("post a"));
    const handler = toFetchHandler(
      new Rhythm<RhythmHttpContext>().use(router.middleware()).use((ctx) => ctx.error(404)),
    );

    expect((await get(handler, "/a")).status).toBe(200);
    expect((await get(handler, "/a", "POST")).status).toBe(200);
    expect((await get(handler, "/nope", "POST")).status).toBe(404);
    expect(seen).toEqual(["mw POST /a"]);
  });

  test("the predicate never widens: a middleware after all routes still never runs", async () => {
    let ran = false;
    const router = new RhythmRouter()
      .get("/a", (ctx) => ctx.text("a"))
      .use(
        async (_ctx, next) => {
          ran = true;
          await next();
        },
        () => true,
      );
    const handler = toFetchHandler(new Rhythm<RhythmHttpContext>().use(router.middleware()));

    await get(handler, "/a");
    expect(ran).toBe(false);
  });

  test("supports an async predicate and passes the request on when it is false", async () => {
    const router = new RhythmRouter()
      .use(
        (ctx) => ctx.error(401),
        async (ctx) => !ctx.request.headers.has("x-key"),
      )
      .get("/a", (ctx) => ctx.text("a"));
    const handler = toFetchHandler(new Rhythm<RhythmHttpContext>().use(router.middleware()));

    expect((await get(handler, "/a")).status).toBe(401);
    expect((await handler(new Request("http://localhost/a", { headers: { "x-key": "1" } }))).status).toBe(200);
  });

  test("a conditional derive does not add its fields to the later handlers' type", () => {
    new RhythmRouter()
      .use(
        derive(() => ({ extra: 1 })),
        () => true,
      )
      .get("/a", (ctx) => {
        // @ts-expect-error
        ctx.extra;
        ctx.text("a");
      });
  });

  test("gates a mounted child router's middleware with the predicate, while its routes still count", async () => {
    const seen: string[] = [];
    const child = new RhythmRouter({ prefix: "/child" }).get("/x", (ctx) => ctx.text("x"));
    const parent = new RhythmRouter()
      .use(
        async (_ctx, next) => {
          seen.push("parent-mw");
          await next();
        },
        (ctx) => new URL(ctx.request.url).pathname === "/child/x",
      )
      .use(child.middleware());
    const handler = toFetchHandler(new Rhythm<RhythmHttpContext>().use(parent.middleware()));

    await get(handler, "/child/x");
    await get(handler, "/other");
    expect(seen).toEqual(["parent-mw"]);
  });

  test("rejects a non-function predicate", () => {
    expect(() => new RhythmRouter().use(() => {}, "x" as any)).toThrow("condition must be a function!");
  });
});

describe("matches()", () => {
  test("a single pattern, wildcard and param", () => {
    const api = matches("/api/**");
    expect(api(ctxFor("/api/users"))).toBe(true);
    expect(api(ctxFor("/api/users/42"))).toBe(true);
    expect(api(ctxFor("/health"))).toBe(false);
    expect(matches("/users/:id")(ctxFor("/users/7"))).toBe(true);
    expect(matches("/users/:id")(ctxFor("/users"))).toBe(false);
  });

  test("a list of patterns", () => {
    const p = matches(["/a", "/b/**"]);
    expect([p(ctxFor("/a")), p(ctxFor("/b/c")), p(ctxFor("/c"))]).toEqual([true, true, false]);
  });

  test("exclude wins over include", () => {
    const p = matches({ include: "/api/**", exclude: "/api/health" });
    expect([p(ctxFor("/api/users")), p(ctxFor("/api/health")), p(ctxFor("/other"))]).toEqual([true, false, false]);
  });

  test("methods restrict the match; with no include they match every path", () => {
    const writes = matches({ methods: ["POST", "PUT"] });
    expect([writes(ctxFor("/x", "POST")), writes(ctxFor("/y", "PUT")), writes(ctxFor("/x", "GET"))]).toEqual([
      true,
      true,
      false,
    ]);
    const p = matches({ include: "/api/**", methods: ["GET"] });
    expect([p(ctxFor("/api/x")), p(ctxFor("/api/x", "POST"))]).toEqual([true, false]);
  });

  test("no options match everything", () => {
    expect(matches({})(ctxFor("/anything"))).toBe(true);
  });

  test("scopes an app-level middleware", async () => {
    const seen: string[] = [];
    const app = new Rhythm<RhythmHttpContext>()
      .use(async (ctx, next) => {
        seen.push(new URL(ctx.request.url).pathname);
        await next();
      }, matches("/api/**"))
      .use((ctx) => ctx.text("ok"));
    const handler = toFetchHandler(app);

    await get(handler, "/api/x");
    await get(handler, "/other");
    expect(seen).toEqual(["/api/x"]);
  });
});

describe("routed(module)", () => {
  test("is true only for requests one of the module's own routers can serve", () => {
    const users = new RhythmRouter({ prefix: "/api/users" }).get("/:id", (ctx) => ctx.text("user"));
    const usersModule = new Rhythm<RhythmHttpContext>({ name: "users", type: "module" }).use(users.middleware());
    const predicate = routed(usersModule);

    expect(predicate(ctxFor("/api/users/7"))).toBe(true);
    expect(predicate(ctxFor("/api/users/7", "POST"))).toBe(false);
    expect(predicate(ctxFor("/other"))).toBe(false);
  });

  test("scopes an app-level middleware to the module's routes", async () => {
    const seen: string[] = [];
    const users = new RhythmRouter({ prefix: "/api/users" }).get("/:id", (ctx) => ctx.text("user"));
    const usersModule = new Rhythm<RhythmHttpContext>({ name: "users", type: "module" }).use(users.middleware());
    const app = new Rhythm<RhythmHttpContext>()
      .use(async (ctx, next) => {
        seen.push(new URL(ctx.request.url).pathname);
        await next();
      }, routed(usersModule))
      .register(usersModule)
      .use((ctx) => ctx.error(404));
    const handler = toFetchHandler(app);

    expect(await (await get(handler, "/api/users/7")).text()).toBe("user");
    expect((await get(handler, "/other")).status).toBe(404);
    expect(seen).toEqual(["/api/users/7"]);
  });

  test("includes routes of nested routers and of modules registered inside the module", () => {
    const inner = new RhythmRouter({ prefix: "/deep" }).get("/x", (ctx) => ctx.text("x"));
    const outer = new RhythmRouter().use(inner.middleware());
    const sub = new Rhythm<RhythmHttpContext>({ name: "sub" }).use(outer.middleware());
    const mod = new Rhythm<RhythmHttpContext>({ name: "mod" }).register(sub);
    const predicate = routed(mod);

    expect(predicate(ctxFor("/deep/x"))).toBe(true);
    expect(predicate(ctxFor("/deep/y"))).toBe(false);
  });
});
