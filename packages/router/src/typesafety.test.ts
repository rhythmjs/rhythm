import { expect, test } from "bun:test";
import { Rhythm, decorate, derive, mount } from "@rhythmjs/rhythm";
import type { RhythmHttpContext } from "./context";
import { toFetchHandler } from "./fetch";
import { RhythmRouter } from "./rhythm-router";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_T extends true>() => {};

test("route params are typed from the path", () => {
  new RhythmRouter()
    .get("/users/:id", (ctx) => {
      assertType<Equal<typeof ctx.params.id, string>>();
      // @ts-expect-error not in the path
      ctx.params.nope;
    })
    .get("/a/:x/b/:y", (ctx) => {
      assertType<Equal<typeof ctx.params.x, string>>();
      assertType<Equal<typeof ctx.params.y, string>>();
    })
    .get("/opt/:id?", (ctx) => {
      assertType<Equal<typeof ctx.params.id, string | undefined>>();
    })
    .get("/files/**:rest", (ctx) => {
      assertType<Equal<typeof ctx.params.rest, string>>();
    })
    .get("/static", (ctx) => {
      // @ts-expect-error no params in a static path
      ctx.params.id;
    });
  expect(true).toBe(true);
});

test("the http context is typed and unknown fields are errors", () => {
  new RhythmRouter().get("/", (ctx) => {
    const request: Request = ctx.request;
    void request;
    ctx.json({ ok: true });
    ctx.text("x", 200);
    ctx.error(404);
    ctx.redirect("/x", 301);
    // @ts-expect-error status must be a number
    ctx.json({}, "200");
    // @ts-expect-error not on the context
    ctx.nope;
    // @ts-expect-error request is readonly
    ctx.request = new Request("http://x");
    ctx.response.status = 201;
    // @ts-expect-error status is a number
    ctx.response.status = "201";
  });
  expect(true).toBe(true);
});

test("a route needs at least one handler, and handlers must be functions", () => {
  const neverRuns = () => {
    // @ts-expect-error
    new RhythmRouter().get("/x");
    // @ts-expect-error
    new RhythmRouter().get("/x", "nope");
  };
  void neverRuns;
  expect(true).toBe(true);
});

test("router-level derive extends the context for every route registered after, with its type", () => {
  new RhythmRouter()
    .get("/before", (ctx) => {
      // @ts-expect-error not derived yet
      ctx.user;
    })
    .use(derive(() => ({ user: { name: "ada" } })))
    .get("/after/:id", (ctx) => {
      assertType<Equal<typeof ctx.user, { name: string }>>();
      assertType<Equal<typeof ctx.params.id, string>>();
      // @ts-expect-error
      ctx.user.nme;
    });
  expect(true).toBe(true);
});

test("a route-level derive only widens that route's later handlers", () => {
  new RhythmRouter()
    .get(
      "/a",
      derive((ctx) => ({ n: ctx.params ? 1 : 0 })),
      (ctx) => {
        assertType<Equal<typeof ctx.n, number>>();
      },
    )
    .get("/b", (ctx) => {
      // @ts-expect-error
      ctx.n;
    });
  expect(true).toBe(true);
});

test("router derive can read the request context and params", () => {
  new RhythmRouter().use(
    derive((ctx) => {
      const request: Request = ctx.request;
      void request;
      assertType<Equal<typeof ctx.params, Record<string, string>>>();
      return { method: ctx.request.method };
    }),
  );
  expect(true).toBe(true);
});

test("use() middleware sees the http context, not unknown fields", () => {
  new RhythmRouter().use((ctx, next) => {
    ctx.text("x");
    // @ts-expect-error
    ctx.nope;
    return next();
  });
  expect(true).toBe(true);
});

test("mount infers what the router needs from the parent's input", () => {
  const needsApp = new RhythmRouter<{ appName: string }>();
  new Rhythm().register(decorate(() => ({ appName: "x" }))).use(mount(needsApp));
  const widened = new Rhythm().use(mount(needsApp));
  const neverRuns = () => {
    // @ts-expect-error appName becomes required input
    void widened.callback()();
    void widened.callback()({ appName: "x" } as never);
  };
  void neverRuns;
  // derived fields of the router itself are not demanded from the parent
  const own = new RhythmRouter().use(derive(() => ({ own: 1 })));
  new Rhythm().use(mount(own));
  expect(true).toBe(true);
});

test("routes see what the router declares it needs", () => {
  new RhythmRouter<{ appName: string }>().get("/", (ctx) => {
    assertType<Equal<typeof ctx.appName, string>>();
  });
  expect(true).toBe(true);
});

test("toFetchHandler accepts routers and apps, and rejects apps needing other input", () => {
  toFetchHandler(new RhythmRouter());
  toFetchHandler(new Rhythm());
  toFetchHandler(new Rhythm<{}, RhythmHttpContext>());
  // @ts-expect-error needs input the fetch runner cannot supply
  toFetchHandler(new Rhythm<{}, { userId: string }>());
  expect(true).toBe(true);
});

test("an app declaring http input sees typed request and response", () => {
  new Rhythm<{}, RhythmHttpContext>().use((ctx) => {
    const request: Request = ctx.request;
    void request;
    // @ts-expect-error
    ctx.nope;
  });
  expect(true).toBe(true);
});

test("mounting a router gives the host the http context without declaring it", () => {
  const app = new Rhythm().use(mount(new RhythmRouter())).use((ctx) => {
    const request: Request = ctx.request;
    void request;
  });
  expect(app).toBeDefined();
});
