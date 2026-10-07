import { test, expect } from "bun:test";
import { Rhythm } from "./rhythm";
import type { ExtensionMiddleware } from "./types";
import { derive } from "./derive";
import { decorate } from "./decorate";
import { mount } from "./mount";
import { include } from "./include";
import { compose } from "./compose";
import type { Next } from "./types";

type Dyn = Record<string, any>;

test("middleware does not run until the handler is called", () => {
  const app = new Rhythm();
  let ran = false;

  app.use(() => {
    ran = true;
  });

  app.callback();

  expect(ran).toBe(false);
});

test("middleware runs on every handler call", async () => {
  const app = new Rhythm();
  let count = 0;

  app.use(() => {
    count++;
  });

  const handler = app.callback();
  await handler();
  await handler();
  await handler();

  expect(count).toBe(3);
});

test("middleware runs onion style around next()", async () => {
  const app = new Rhythm();
  const calls: string[] = [];

  app.use(async (_ctx, next) => {
    calls.push("1 in");
    await next();
    calls.push("1 out");
  });
  app.use(async (_ctx, next) => {
    calls.push("2 in");
    await next();
    calls.push("2 out");
  });
  app.use(() => {
    calls.push("3");
  });

  await app.callback()();

  expect(calls).toEqual(["1 in", "2 in", "3", "2 out", "1 out"]);
});

test("not calling next() stops the chain", async () => {
  const app = new Rhythm();
  const calls: string[] = [];

  app.use(() => {
    calls.push("first");
  });
  app.use(() => {
    calls.push("second");
  });

  await app.callback()();

  expect(calls).toEqual(["first"]);
});

test("calling next() multiple times rejects", async () => {
  const app = new Rhythm();

  app.use(async (_ctx, next) => {
    await next();
    await next();
  });

  expect(app.callback()()).rejects.toThrow("next() called multiple times");
});

test("use is chainable", async () => {
  const app = new Rhythm();
  const calls: string[] = [];

  app
    .use(async (_ctx, next) => {
      calls.push("first");
      await next();
    })
    .use(() => calls.push("second"));

  await app.callback()();

  expect(calls).toEqual(["first", "second"]);
});

test("startup context is readable in middleware", async () => {
  const app = new Rhythm().register(decorate(() => ({ db: "connected" })));
  let seen: unknown;

  app.use((ctx) => {
    seen = ctx.db;
  });

  await app.callback()();

  expect(seen).toBe("connected");
});

test("downstream middleware sees the latest ctx value, upstream sees changes on the way out", async () => {
  const app = new Rhythm().register(decorate(() => ({ value: "initial" })));
  const seen: unknown[] = [];

  app.use(async (ctx, next) => {
    seen.push(ctx.value);
    ctx.value = "updated";
    await next();
    seen.push(ctx.value);
  });
  app.use((ctx) => {
    seen.push(ctx.value);
    ctx.value = "final";
  });

  await app.callback()();

  expect(seen).toEqual(["initial", "updated", "final"]);
});

test("each handler call gets a fresh ctx seeded from the startup context", async () => {
  const initial = { count: 0 };
  const app = new Rhythm().register(decorate(() => ({ ...initial })));
  const seen: number[] = [];

  app.use((ctx) => {
    ctx.count += 1;
    seen.push(ctx.count);
  });

  const handler = app.callback();
  await handler();
  await handler();

  expect(seen).toEqual([1, 1]);
  expect(initial.count).toBe(0);
});

test("handler can extend ctx per invocation without leaking to the next", async () => {
  const app = new Rhythm<Dyn>();
  const seen: unknown[] = [];

  app.use((ctx) => {
    seen.push(ctx.runId);
  });

  const handler = app.callback();
  await handler({ runId: "a" });
  await handler({ runId: "b" });
  await handler();

  expect(seen).toEqual(["a", "b", undefined]);
});

test("handler resolves with the final ctx", async () => {
  const app = new Rhythm<Dyn>().register(decorate(() => ({ base: 1 })));

  app.use(async (ctx, next) => {
    await next();
    ctx.result = ctx.base + ctx.bonus;
  });

  const ctx = await app.callback()({ bonus: 10 });

  expect(ctx.result).toBe(11);
});

test("callback snapshots the chain; later use() is not included", async () => {
  const app = new Rhythm();
  const calls: string[] = [];

  app.use(async (_ctx, next) => {
    calls.push("first");
    await next();
  });

  const handler = app.callback();

  app.use(() => {
    calls.push("second");
  });

  await handler();
  await app.callback()();

  expect(calls).toEqual(["first", "first", "second"]);
});

test("concurrent handler calls do not share ctx", async () => {
  const app = new Rhythm<Dyn>();
  const seen: unknown[] = [];

  app.use(async (ctx, next) => {
    await Bun.sleep(ctx.delay);
    seen.push(ctx.name);
    await next();
  });

  const handler = app.callback();
  await Promise.all([handler({ name: "slow", delay: 20 }), handler({ name: "fast", delay: 0 })]);

  expect(seen).toEqual(["fast", "slow"]);
});

test("ctx allows properties not in the startup context", async () => {
  const app = new Rhythm<Dyn>().register(decorate(() => ({ a: 1 })));
  let seen: unknown;

  app.use(async (ctx, next) => {
    ctx.extra = "later";
    await next();
  });
  app.use((ctx) => {
    seen = ctx.extra;
  });

  await app.callback()();

  expect(seen).toBe("later");
});

test("derive adds values to ctx for downstream middleware", async () => {
  let seen: number | undefined;

  const app = new Rhythm().use(derive(() => ({ someValue: 10 }))).use((ctx) => {
    const typed: number = ctx.someValue;
    seen = typed;
  });

  await app.callback()();

  expect(seen).toBe(10);
});

test("derive factory can be async and read existing ctx", async () => {
  let seen: unknown;

  const app = new Rhythm()
    .register(decorate(() => ({ base: 5 })))
    .use(derive(async (ctx) => ({ doubled: ctx.base * 2 })))
    .use((ctx) => {
      seen = ctx.doubled;
    });

  await app.callback()();

  expect(seen).toBe(10);
});

test("derive runs fresh on every handler call", async () => {
  const seen: number[] = [];
  let source = 0;

  const app = new Rhythm().use(derive(() => ({ value: ++source }))).use((ctx) => {
    seen.push(ctx.value);
  });

  const handler = app.callback();
  await handler();
  await handler();

  expect(seen).toEqual([1, 2]);
});

test("any helper following the Extension convention widens ctx", async () => {
  function timed<T extends object>(): ExtensionMiddleware<T, { startedAt: number }> {
    const middleware = async (ctx: Record<string, any>, next: Next) => {
      ctx.startedAt = Date.now();
      await next();
    };
    return middleware as ExtensionMiddleware<T, { startedAt: number }>;
  }

  let seen: number | undefined;

  const app = new Rhythm().use(timed()).use((ctx) => {
    const typed: number = ctx.startedAt;
    seen = typed;
  });

  await app.callback()();

  expect(seen).toBeNumber();
});

test("register runs immediately, once, not per handler call", async () => {
  const app = new Rhythm();
  let startups = 0;
  let requests = 0;

  app.register(() => {
    startups++;
  });
  app.use(() => {
    requests++;
  });

  expect(startups).toBe(1);

  const handler = app.callback();
  await handler();
  await handler();

  expect(startups).toBe(1);
  expect(requests).toBe(2);
});

test("register sees the latest base ctx at call time", () => {
  const seen: unknown[] = [];

  new Rhythm<Dyn>()
    .register(decorate(() => ({ a: 1 })))
    .register((ctx) => {
      seen.push(ctx.b);
      ctx.b = 2;
    })
    .register((ctx) => {
      seen.push(ctx.a + ctx.b);
    });

  expect(seen).toEqual([undefined, 3]);
});

test("register mutates the base ctx, visible in every request ctx", async () => {
  const app = new Rhythm<Dyn>()
    .register(decorate(() => ({ env: "test" })))
    .register((ctx) => {
      ctx.db = "connected";
    })
    .use(async (ctx, next) => {
      ctx.seen = `${ctx.db}:${ctx.env}`;
      await next();
    });

  const handler = app.callback();
  const first = await handler();
  const second = await handler();

  expect(first.seen).toBe("connected:test");
  expect(second.seen).toBe("connected:test");
});

test("decorate adds typed values to base ctx at register time", async () => {
  const app = new Rhythm<Dyn>()
    .register(decorate(() => ({ env: "test" })))
    .register(decorate((ctx) => ({ db: `pool:${ctx.env}` })))
    .use(async (ctx, next) => {
      const typed: string = ctx.db;
      ctx.seen = typed;
      await next();
    });

  const first = await app.callback()();
  const second = await app.callback()();

  expect(first.seen).toBe("pool:test");
  expect(second.seen).toBe("pool:test");
});

test("decorate runs once at register time, not per handler call", async () => {
  let calls = 0;

  const app = new Rhythm().register(
    decorate(() => {
      calls++;
      return { value: calls };
    }),
  );

  const handler = app.callback();
  await handler();
  await handler();

  expect(calls).toBe(1);
});

test("register sees base ctx only, never request extras or request mutations", async () => {
  const seen: unknown[] = [];
  const initial: Record<string, any> = {};
  const app = new Rhythm().register(decorate(() => ({ ...initial })));

  app.register((ctx) => {
    seen.push(ctx.runId);
  });
  app.use(async (ctx, next) => {
    ctx.leak = true;
    await next();
  });

  const handler = app.callback();
  await handler({ runId: "a" });

  expect(seen).toEqual([undefined]);
  expect(initial.leak).toBeUndefined();
  expect(initial.runId).toBeUndefined();
});

test("register receives the app instance as the second argument", async () => {
  const calls: string[] = [];

  const app = new Rhythm();
  app.register((_ctx, self) => {
    expect(self).toBe(app);
    self.use(() => {
      calls.push("added from register");
    });
  });

  await app.callback()();

  expect(calls).toEqual(["added from register"]);
});

test("mount runs the child per request with the parent's ctx visible", async () => {
  const seen: unknown[] = [];
  const child = new Rhythm<Dyn>().register(decorate(() => ({ name: "child", own: "kept" }))).use(async (ctx, next) => {
    seen.push(`${ctx.name}:${ctx.own}:${ctx.input}`);
    await next();
  });

  const app = new Rhythm<Dyn>().register(decorate(() => ({ name: "parent" }))).use(mount(child));
  const handler = app.callback();

  await handler({ input: "a" });
  await handler({ input: "b" });

  expect(seen).toEqual(["parent:kept:a", "parent:kept:b"]);
});

test("mount does not update the parent ctx", async () => {
  const child = new Rhythm<Dyn>()
    .register(decorate(() => ({ base: 1 })))
    .use(derive(() => ({ derived: 2 })))
    .use(async (ctx, next) => {
      ctx.mutated = true;
      await next();
    });

  const app = new Rhythm<Dyn>().use(mount(child));

  const result = await app.callback()();

  expect(result.base).toBeUndefined();
  expect(result.derived).toBeUndefined();
  expect(result.mutated).toBeUndefined();
});

test("mount runs at its position and then continues the parent chain", async () => {
  const calls: string[] = [];
  const child = new Rhythm().use(async (_ctx, next) => {
    calls.push("child in");
    await next();
    calls.push("child out");
  });

  const app = new Rhythm()
    .use(async (_ctx, next) => {
      calls.push("app in");
      await next();
      calls.push("app out");
    })
    .use(mount(child))
    .use(() => {
      calls.push("app last");
    });

  await app.callback()();

  expect(calls).toEqual(["app in", "child in", "child out", "app last", "app out"]);
});

test("mount condition is checked per request", async () => {
  const seen: unknown[] = [];
  const child = new Rhythm<Dyn>().use(async (ctx, next) => {
    seen.push(ctx.id);
    await next();
  });

  const app = new Rhythm<Dyn>().use(mount(child, (ctx) => ctx.id !== 2));
  const handler = app.callback();

  await handler({ id: 1 });
  await handler({ id: 2 });
  await handler({ id: 3 });

  expect(seen).toEqual([1, 3]);
});

test("mount defaults to running when no condition is given", async () => {
  let ran = false;
  const child = new Rhythm().use(async (_ctx, next) => {
    ran = true;
    await next();
  });

  await new Rhythm().use(mount(child)).callback()();

  expect(ran).toBe(true);
});

test("register cleanup does not run until stop()", async () => {
  let cleaned = false;
  const app = new Rhythm().register(
    () => {},
    () => {
      cleaned = true;
    },
  );

  await app.callback()();
  expect(cleaned).toBe(false);

  await app.stop();
  expect(cleaned).toBe(true);
});

test("cleanup receives the base ctx with typed decorated values", async () => {
  const closed: string[] = [];
  const app = new Rhythm().register(decorate(() => ({ env: "test" }))).register(
    decorate((ctx) => ({ db: { name: `pool:${ctx.env}` } })),
    (ctx) => {
      const typed: string = ctx.db.name;
      closed.push(typed);
    },
  );

  await app.stop();

  expect(closed).toEqual(["pool:test"]);
});

test("cleanups run in reverse registration order", async () => {
  const calls: string[] = [];
  const app = new Rhythm()
    .register(
      () => {},
      () => void calls.push("first"),
    )
    .register(
      () => {},
      () => void calls.push("second"),
    )
    .register(
      () => {},
      () => void calls.push("third"),
    );

  await app.stop();

  expect(calls).toEqual(["third", "second", "first"]);
});

test("async cleanups are awaited in order", async () => {
  const calls: string[] = [];
  const app = new Rhythm()
    .register(
      () => {},
      () => void calls.push("outer"),
    )
    .register(
      () => {},
      async () => {
        await Bun.sleep(10);
        calls.push("inner");
      },
    );

  await app.stop();

  expect(calls).toEqual(["inner", "outer"]);
});

test("cleanup is not recorded when setup throws", async () => {
  let cleaned = false;
  const app = new Rhythm();

  expect(() =>
    app.register(
      () => {
        throw new Error("boom");
      },
      () => {
        cleaned = true;
      },
    ),
  ).toThrow("boom");

  await app.stop();

  expect(cleaned).toBe(false);
});

test("a failing cleanup does not stop the others; stop() rejects with all errors", async () => {
  const calls: string[] = [];
  const app = new Rhythm()
    .register(
      () => {},
      () => void calls.push("first"),
    )
    .register(
      () => {},
      () => {
        throw new Error("second failed");
      },
    )
    .register(
      () => {},
      () => {
        throw new Error("third failed");
      },
    );

  const error = await app.stop().catch((e) => e);

  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors.map((e: Error) => e.message)).toEqual(["third failed", "second failed"]);
  expect(calls).toEqual(["first"]);
});

test("stop() is idempotent", async () => {
  let cleanups = 0;
  const app = new Rhythm().register(
    () => {},
    () => {
      cleanups++;
    },
  );

  await app.stop();
  await app.stop();

  expect(cleanups).toBe(1);
});

test("await using stops the app at scope exit", async () => {
  let cleaned = false;

  {
    await using app = new Rhythm().register(
      () => {},
      () => {
        cleaned = true;
      },
    );
    expect(cleaned).toBe(false);
    void app;
  }

  expect(cleaned).toBe(true);
});

test("include runs a child Rhythm once at register time, seeing the parent's base ctx", async () => {
  const seen: unknown[] = [];
  const child = new Rhythm<Dyn>().register(decorate(() => ({ name: "child", own: "kept" }))).use(async (ctx, next) => {
    seen.push(`${ctx.name}:${ctx.own}:${ctx.late}`);
    await next();
  });

  const app = new Rhythm<Dyn>()
    .register(decorate(() => ({ name: "parent" })))
    .register((ctx) => {
      ctx.late = "yes";
    })
    .register(include(child));

  expect(seen).toEqual(["parent:kept:yes"]);

  const handler = app.callback();
  await handler();
  await handler();

  expect(seen).toHaveLength(1);
});

test("include without a select callback exports nothing from the child", async () => {
  const initial: Record<string, any> = {};
  const child = new Rhythm<Dyn>()
    .register(decorate(() => ({ base: 1 })))
    .use(derive(() => ({ derived: 2 })))
    .use(async (ctx, next) => {
      ctx.mutated = true;
      await next();
    });

  const app = new Rhythm<Dyn>().register(decorate(() => ({ ...initial }))).register(include(child));
  const result = await app.callback()();

  expect(initial.base).toBeUndefined();
  expect(result.base).toBeUndefined();
  expect(result.derived).toBeUndefined();
  expect(result.mutated).toBeUndefined();
});

test("include cascades: stopping the parent stops the child", async () => {
  const calls: string[] = [];
  const child = new Rhythm().register(
    () => {},
    () => void calls.push("child cleanup"),
  );

  const app = new Rhythm().register(
    () => {},
    () => void calls.push("parent cleanup"),
  );
  app.register(include(child));

  await app.stop();

  expect(calls).toEqual(["child cleanup", "parent cleanup"]);
});

test("include select exports chosen child values into the parent, typed", async () => {
  const child = new Rhythm<Dyn>()
    .register(decorate(() => ({ secret: "s3cret" })))
    .use(derive((ctx) => ({ user: `user:${ctx.secret.length}` })));

  const app = new Rhythm<Dyn>().register(include(child, (c) => ({ user: c.user })));

  const result = await app.callback()();
  const typed: string = result.user;

  expect(typed).toBe("user:6");
  expect(result.secret).toBeUndefined();
});

test("include select can rename and compute values", async () => {
  const child = new Rhythm<Dyn>().register(decorate(() => ({ users: ["ada", "linus"] })));

  const app = new Rhythm<Dyn>().register(include(child, (c) => ({ userCount: c.users.length })));

  const result = await app.callback()();

  expect(result.userCount).toBe(2);
  expect(result.users).toBeUndefined();
});

test("include select value wins over an existing parent value", async () => {
  const child = new Rhythm<Dyn>().use(async (ctx, next) => {
    ctx.name = "child";
    await next();
  });

  const app = new Rhythm<Dyn>()
    .register(decorate(() => ({ name: "parent" })))
    .register(include(child, (c) => ({ name: c.name })));

  const result = await app.callback()();

  expect(result.name).toBe("child");
});

test("include select reaches the very first request, even from an async child", async () => {
  const child = new Rhythm<Dyn>().use(async (ctx, next) => {
    await Bun.sleep(20);
    ctx.token = "ready";
    await next();
  });

  const seen: unknown[] = [];
  const app = new Rhythm<Dyn>().register(include(child, (c) => ({ token: c.token }))).use((ctx) => {
    seen.push(ctx.token);
  });

  const handler = app.callback();
  await Promise.all([handler(), handler()]);

  expect(seen).toEqual(["ready", "ready"]);
});

test("compose is standalone and works with any ctx", async () => {
  const ctx = { log: [] as string[] };
  const fn = compose<typeof ctx>([
    async (c, next) => {
      c.log.push("a");
      await next();
      c.log.push("c");
    },
    (c) => {
      c.log.push("b");
    },
  ]);

  await fn(ctx);

  expect(ctx.log).toEqual(["a", "b", "c"]);
});
