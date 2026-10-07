import { expect, test } from "bun:test";
import { Rhythm, decorate, derive, include, mount, type ExtensionMiddleware } from "./rhythm";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_T extends true>() => {};

test("unknown context fields are compile errors", () => {
  new Rhythm().use((ctx) => {
    // @ts-expect-error
    ctx.nope;
  });
  new Rhythm().register((ctx) => {
    // @ts-expect-error
    ctx.nope;
  });
  new Rhythm().use(
    derive((ctx) => {
      // @ts-expect-error
      ctx.nope;
      return {};
    }),
  );
  expect(true).toBe(true);
});

test("derive adds exactly the returned fields, with their types, after it only", () => {
  new Rhythm()
    .use((ctx) => {
      // @ts-expect-error not derived yet
      ctx.user;
    })
    .use(derive(() => ({ user: { name: "ada", age: 1 } })))
    .use((ctx) => {
      assertType<Equal<typeof ctx.user, { name: string; age: number }>>();
      // @ts-expect-error
      ctx.user.nme;
      // @ts-expect-error
      const wrong: number = ctx.user.name;
    });
  expect(true).toBe(true);
});

test("async derive resolves its promise type", () => {
  new Rhythm().use(derive(async () => ({ n: 1 }))).use((ctx) => {
    assertType<Equal<typeof ctx.n, number>>();
  });
  expect(true).toBe(true);
});

test("derive sees the context built so far", () => {
  new Rhythm()
    .use(derive(() => ({ a: 1 })))
    .use(derive((ctx) => ({ b: ctx.a + 1 })))
    .use((ctx) => {
      assertType<Equal<typeof ctx.b, number>>();
    });
  expect(true).toBe(true);
});

test("decorate extends the startup context for later register and use, not earlier", () => {
  new Rhythm()
    .register((ctx) => {
      // @ts-expect-error not decorated yet
      ctx.db;
    })
    .register(decorate(() => ({ db: "conn" })))
    .register((ctx) => {
      assertType<Equal<typeof ctx.db, string>>();
    })
    .use((ctx) => {
      assertType<Equal<typeof ctx.db, string>>();
      // @ts-expect-error
      const n: number = ctx.db;
    });
  expect(true).toBe(true);
});

test("cleanup callbacks see the decorated context", () => {
  new Rhythm().register(
    decorate(() => ({ db: { close() {} } })),
    (ctx) => {
      ctx.db.close();
      // @ts-expect-error
      ctx.db.open();
    },
  );
  expect(true).toBe(true);
});

test("request-derived fields are not visible at startup", () => {
  new Rhythm().use(derive(() => ({ requestId: "x" }))).register((ctx) => {
    // @ts-expect-error
    ctx.requestId;
  });
  expect(true).toBe(true);
});

test("the handler's result context is typed", async () => {
  const ctx = await new Rhythm()
    .register(decorate(() => ({ db: 1 })))
    .use(derive(() => ({ user: "ada" })))
    .callback()();
  assertType<Equal<typeof ctx.db, number>>();
  assertType<Equal<typeof ctx.user, string>>();
  // @ts-expect-error
  ctx.nope;
  expect(ctx.user).toBe("ada");
});

test("typed input is required, checked, and visible in middleware", () => {
  const app = new Rhythm<{}, { userId: string }>().use((ctx) => {
    assertType<Equal<typeof ctx.userId, string>>();
    // @ts-expect-error
    ctx.other;
  });
  void app.callback()({ userId: "x" });
  // @ts-expect-error input required
  void app.callback()();
  // @ts-expect-error wrong type
  void app.callback()({ userId: 1 });
  // @ts-expect-error missing field
  void app.callback()({});
  new Rhythm().callback()();
  expect(true).toBe(true);
});

test("input is not visible at startup, derive widens on top of it", () => {
  new Rhythm<{}, { userId: string }>()
    .register((ctx) => {
      // @ts-expect-error input arrives per call
      ctx.userId;
    })
    .use(derive((ctx) => ({ upper: ctx.userId.toUpperCase() })))
    .use((ctx) => {
      assertType<Equal<typeof ctx.upper, string>>();
      assertType<Equal<typeof ctx.userId, string>>();
    });
  expect(true).toBe(true);
});

test("the handler result keeps input and derived types", async () => {
  const ctx = await new Rhythm<{}, { userId: string }>().use(derive(() => ({ n: 1 }))).callback()({ userId: "u" });
  assertType<Equal<typeof ctx.userId, string>>();
  assertType<Equal<typeof ctx.n, number>>();
});

test("mount widens the parent's input; include requires the parent to supply it", () => {
  const needs = new Rhythm<{}, { name: string }>();
  new Rhythm<{ name: string }>().use(mount(needs));
  new Rhythm<{ name: string }>().register(include(needs));
  // @ts-expect-error
  new Rhythm().register(include(needs));
  // mounting infers the input instead of requiring it to be declared
  const inferred = new Rhythm().use(mount(needs));
  assertType<Equal<Parameters<ReturnType<typeof inferred.callback>>[0], { name: string }>>();
  inferred.use((ctx) => {
    assertType<Equal<typeof ctx.name, string>>();
  });
  // @ts-expect-error the inferred input must be supplied
  void inferred.callback()();
  // supplied through decorate
  new Rhythm().register(decorate(() => ({ name: "x" }))).use(mount(needs));
  expect(true).toBe(true);
});

test("include picks are typed and the child's other fields stay sealed", () => {
  const child = new Rhythm().register(decorate(() => ({ db: 1, secret: "s" })));
  new Rhythm().register(include(child, (c) => ({ db: c.db }))).use((ctx) => {
    assertType<Equal<typeof ctx.db, number>>();
    // @ts-expect-error secret was not picked
    ctx.secret;
  });
  new Rhythm().register(
    include(child, (c) => ({
      // @ts-expect-error not on the child
      x: c.nope,
    })),
  );
  expect(true).toBe(true);
});

test("a mounted module's derived fields do not leak into the parent type", () => {
  const child = new Rhythm().use(derive(() => ({ secret: "s" })));
  new Rhythm().use(mount(child)).use((ctx) => {
    // @ts-expect-error
    ctx.secret;
  });
  expect(true).toBe(true);
});

test("next() takes no arguments and middleware must be functions", () => {
  const neverRuns = () => {
    new Rhythm().use((_, next) => {
      // @ts-expect-error
      return next({ extra: 1 });
    });
    // @ts-expect-error
    new Rhythm().use("nope");
    // @ts-expect-error
    new Rhythm().register(42);
  };
  void neverRuns;
  expect(true).toBe(true);
});

test("a condition on mount sees the parent context", () => {
  new Rhythm().use(derive(() => ({ flag: true }))).use(
    mount(new Rhythm(), (ctx) => {
      assertType<Equal<typeof ctx.flag, boolean>>();
      // @ts-expect-error
      ctx.nope;
      return ctx.flag;
    }),
  );
  expect(true).toBe(true);
});

test("an extension middleware is rejected where its required context is missing", () => {
  const needsUser = derive((ctx: { user: string }) => ({ upper: ctx.user.toUpperCase() }));
  new Rhythm().use(derive(() => ({ user: "a" }))).use(needsUser);
  // @ts-expect-error user is missing
  new Rhythm().use(needsUser);
  const m: ExtensionMiddleware<{}, { x: 1 }> = derive(() => ({ x: 1 as const }));
  void m;
  expect(true).toBe(true);
});

test("mount only widens the input by what the parent has not already supplied", () => {
  const router = new Rhythm<{}, { request: Request; service: { n: number } }>();
  const app = new Rhythm().register(decorate(() => ({ service: { n: 1 } }))).use(mount(router));
  assertType<Equal<Parameters<ReturnType<typeof app.callback>>[0], { request: Request }>>();
  expect(true).toBe(true);
});

test("a typed condition on mount widens the parent's input", () => {
  const child = new Rhythm();
  const app = new Rhythm().use(mount(child, (ctx: { id: number }) => ctx.id > 0));
  assertType<Equal<Parameters<ReturnType<typeof app.callback>>[0], { id: number }>>();
  expect(true).toBe(true);
});
