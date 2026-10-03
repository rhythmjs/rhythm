import { withSource } from "./source";
import { describe, expect, test } from "bun:test";
import { derive, Rhythm } from "./rhythm";
import type { Middleware } from "./types";

describe("onion middleware", () => {
  test("runs before/after next() in onion order", async () => {
    const order: string[] = [];
    const app = new Rhythm<{}>()
      .use(async (ctx, next) => {
        order.push("a:before");
        await next();
        order.push("a:after");
      })
      .use(async (ctx, next) => {
        order.push("b:before");
        await next();
        order.push("b:after");
      })
      .use(() => {
        order.push("c");
      });

    await app.run({});
    expect(order).toEqual(["a:before", "b:before", "c", "b:after", "a:after"]);
  });

  test("next() is pure koa style: context extension happens through derive(), not next(extra)", async () => {
    const app = new Rhythm<{}>().use(derive(() => ({ user: "Alice" }))).use((ctx) => {
      expect(ctx.user).toBe("Alice");
    });

    const result = await app.run({});
    expect(result.user).toBe("Alice");
  });

  test("calling next() twice rejects", async () => {
    const app = new Rhythm<{}>().use(async (ctx, next) => {
      await next();
      await next();
    });

    await expect(app.run({})).rejects.toThrow("next() called multiple times");
  });

  test("use() rejects a non-function immediately, at the call site, not lazily on run()", () => {
    const app = new Rhythm<{}>();
    expect(() => app.use(undefined as any)).toThrow("middleware must be a function!");
  });
});

describe("register()", () => {
  test("a module's own context extension stays isolated by default", async () => {
    const child = new Rhythm<{}>().use(derive(() => ({ secret: "hidden" })));

    let seen: unknown;
    const app = new Rhythm<{}>().register(child).use((ctx) => {
      seen = (ctx as Record<string, unknown>).secret;
    });

    await app.run({});
    expect(seen).toBeUndefined();
  });

  test("register(module, exportValue) opts in to promoting specific fields", async () => {
    const child = new Rhythm<{}>().use(derive(() => ({ secret: "hidden" })));

    const app = new Rhythm<{}>()
      .register(child, (result) => ({ secret: result.secret }))
      .use((ctx) => {
        expect(ctx.secret).toBe("hidden");
      });

    const result = await app.run({});
    expect(result.secret).toBe("hidden");
  });

  test("a module throwing is tagged with its name and preserves the original error as cause", async () => {
    const child = new Rhythm<{}>({ name: "payments" }).use(() => {
      throw new Error("card declined");
    });
    const app = new Rhythm<{}>().register(child);

    try {
      await app.run({});
      throw new Error("expected app.run to reject");
    } catch (err) {
      expect((err as Error).message).toBe('registered module "payments" failed');
      expect(((err as Error).cause as Error).message).toBe("card declined");
    }
  });

  test('options.type overrides the default "module" label used in the register() error', async () => {
    const child = new Rhythm<{}>({ name: "users", type: "controller" }).use(() => {
      throw new Error("boom");
    });
    const app = new Rhythm<{}>().register(child);

    await expect(app.run({})).rejects.toThrow('registered controller "users" failed');
  });

  test("a module can catch its own downstream errors before they reach register()", async () => {
    const events: string[] = [];
    const child = new Rhythm<{}>({ name: "safe" })
      .use(async (ctx, next) => {
        try {
          await next();
        } catch (err) {
          events.push(`caught: ${(err as Error).message}`);
        }
      })
      .use(() => {
        throw new Error("boom");
      });

    const app = new Rhythm<{}>().register(child).use(() => {
      events.push("app continued");
    });

    await app.run({});
    expect(events).toEqual(["caught: boom"]);
  });

  test("a module that ends the chain without calling next() stops the parent; calling through continues it", async () => {
    const events: string[] = [];
    const ends = new Rhythm<{}>().use(() => {
      events.push("ends");
    });
    const passes = new Rhythm<{}>().use(async (_ctx, next) => {
      events.push("passes");
      await next();
    });

    await new Rhythm<{}>()
      .register(ends)
      .use(() => void events.push("after ends"))
      .run({});
    await new Rhythm<{}>()
      .register(passes)
      .use(() => void events.push("after passes"))
      .run({});
    expect(events).toEqual(["ends", "passes", "after passes"]);
  });

  test("errors from the parent's downstream are not wrapped as module failures", async () => {
    const child = new Rhythm<{}>({ name: "ok" }).use(async (_ctx, next) => {
      await next();
    });
    const app = new Rhythm<{}>().register(child).use(() => {
      throw new Error("downstream");
    });
    await expect(app.run({})).rejects.toThrow(/^downstream$/);
  });

  test.skip("type system: a non-exported field is not visible on the parent's context", () => {
    const child = new Rhythm<{}>().use(derive(() => ({ secret: "hidden" })));
    new Rhythm<{}>().register(child).use((ctx) => {
      // @ts-expect-error
      return ctx.secret;
    });
  });

  test.skip("type system: a module needing fields the parent doesn't have cannot be registered", () => {
    const needsToken = new Rhythm<{ token: string }>().use((ctx) => {
      ctx.token;
    });
    // @ts-expect-error
    new Rhythm<{}>().register(needsToken);
  });
});

describe("ctx is mutable, koa-style", () => {
  test("middleware mutates declared context fields directly, fully typed", async () => {
    const app = new Rhythm<{ user: { name: string } }>().use(async (ctx, next) => {
      ctx.user.name = "mutated";
      await next();
    });

    const result = await app.run({ user: { name: "original" } });
    expect(result.user.name).toBe("mutated");
  });
});

describe("derive()", () => {
  test("an async factory's return extends the context for downstream middleware", async () => {
    const app = new Rhythm<{ token: string }>()
      .use(derive(async (ctx) => ({ user: `user-of-${ctx.token}` })))
      .use((ctx) => {
        expect(ctx.user).toBe("user-of-t1");
      });

    const result = await app.run({ token: "t1" });
    expect(result.user).toBe("user-of-t1");
  });

  test("derive() is positional: middleware registered before it doesn't see the value on the way down", async () => {
    const seen: unknown[] = [];
    const app = new Rhythm<{}>()
      .use(async (ctx, next) => {
        seen.push((ctx as Record<string, unknown>).user);
        await next();
      })
      .use(derive(() => ({ user: "Alice" })))
      .use((ctx) => {
        seen.push(ctx.user);
      });

    await app.run({});
    expect(seen).toEqual([undefined, "Alice"]);
  });

  test("keys prefixed with # are stripped from the context", async () => {
    const app = new Rhythm<{}>().use(derive(() => ({ user: "Alice", "#raw": "internal" }))).use((ctx) => {
      expect((ctx as any)["#raw"]).toBeUndefined();
      expect(ctx.user).toBe("Alice");
    });

    const result = await app.run({});
    expect((result as any)["#raw"]).toBeUndefined();
  });

  test("a throwing derive short-circuits downstream and is catchable by an earlier use()", async () => {
    const events: string[] = [];
    const app = new Rhythm<{}>()
      .use(async (ctx, next) => {
        try {
          await next();
        } catch (err) {
          events.push(`caught: ${(err as Error).message}`);
        }
      })
      .use(
        derive(() => {
          throw new Error("invalid token");
        }),
      )
      .use(() => {
        events.push("unreached");
      });

    await app.run({});
    expect(events).toEqual(["caught: invalid token"]);
  });

  test("derive() rejects a non-function immediately, before use()", () => {
    expect(() => derive(undefined as any)).toThrow("derive factory must be a function!");
  });
});

describe("context", () => {
  interface Db {
    name: string;
  }

  test("startup values assigned before serving reach every run", async () => {
    const db: Db = { name: "db" };
    const app = new Rhythm<{}, { db: Db }>().use((ctx) => {
      expect(ctx.db).toBe(db);
    });
    app.context.db = db;

    await app.run({});
    await app.run({});
  });

  test("assignments and reads are typed from the declared shape", async () => {
    const app = new Rhythm<{}, { db: Db; port: number }>().use((ctx) => {
      const name: string = ctx.db.name;
      const port: number = ctx.port;
      expect([name, port]).toEqual(["db", 3000]);
    });
    app.context.db = { name: "db" };
    app.context.port = 3000;
    // @ts-expect-error
    app.context.port = "3000";
    // @ts-expect-error
    app.context.nope = 1;
    app.context.port = 3000;

    await app.run({});
  });

  test("a registered module inherits the parent's context", async () => {
    let seen: unknown;
    const child = new Rhythm<{ db: string }>({ name: "child" }).use((ctx) => {
      seen = ctx.db;
    });
    const app = new Rhythm<{}, { db: string }>().register(child);
    app.context.db = "parent-db";

    await app.run({});
    expect(seen).toBe("parent-db");
  });

  test("a module's own context is visible to it but not to its parent", async () => {
    const seen: Record<string, unknown> = {};
    const child = new Rhythm<{}, { cache: string }>({ name: "child" }).use(async (ctx, next) => {
      seen.child = ctx.cache;
      await next();
    });
    child.context.cache = "child-cache";
    const app = new Rhythm<{}>().register(child).use((ctx) => {
      seen.parent = "reached";
      seen.leaked = "cache" in ctx;
    });

    await app.run({});
    expect(seen).toEqual({ child: "child-cache", parent: "reached", leaked: false });
  });

  test("a module's context shadows the parent's for that module only", async () => {
    const seen: Record<string, unknown> = {};
    const child = new Rhythm<{}, { db: string }>({ name: "child" }).use(async (ctx, next) => {
      seen.child = ctx.db;
      await next();
    });
    child.context.db = "child-db";
    const app = new Rhythm<{}, { db: string }>().register(child).use((ctx) => {
      seen.parent = ctx.db;
    });
    app.context.db = "parent-db";

    await app.run({});
    expect(seen).toEqual({ child: "child-db", parent: "parent-db" });
  });

  test("values assigned after the app is built are picked up on the next run", async () => {
    const seen: unknown[] = [];
    const app = new Rhythm<{}, { count: number }>().use((ctx) => {
      seen.push(ctx.count);
    });
    app.context.count = 1;
    await app.run({});
    app.context.count = 2;
    await app.run({});
    expect(seen).toEqual([1, 2]);
  });

  test("per-request input wins over a startup value with the same key", async () => {
    let seen: unknown;
    const app = new Rhythm<{ tag?: string }, { tag?: string }>().use((ctx) => {
      seen = ctx.tag;
    });
    app.context.tag = "startup";
    await app.run({ tag: "request" });
    expect(seen).toBe("request");
  });

  test("register() rejects, at compile time, a module whose required context the parent doesn't have", () => {
    const child = new Rhythm<{ db: string }>({ name: "child" });
    // @ts-expect-error
    new Rhythm<{}>().register(child);
  });

  test("register() accepts a module whose required context comes from the parent's startup shape", () => {
    const child = new Rhythm<{ db: string }>({ name: "child" });
    new Rhythm<{}, { db: string }>().register(child);
  });

  test("middleware() mounts the module's context onto the shared ctx", async () => {
    const child = new Rhythm<{}, { greeting: string }>();
    child.context.greeting = "hi";
    const ctx: Record<string, unknown> = {};
    await child.middleware()(ctx as any, (async () => ctx) as any);
    expect(ctx.greeting).toBe("hi");
  });
});

describe("conditional middleware: use(fn, condition)", () => {
  test("runs fn only when the predicate is true, otherwise falls through to next()", async () => {
    const events: string[] = [];
    const app = new Rhythm<{ path: string }>()
      .use(
        async (_ctx, next) => {
          events.push("guarded");
          await next();
        },
        (ctx) => ctx.path.startsWith("/api"),
      )
      .use(() => {
        events.push("end");
      });

    await app.run({ path: "/api/users" });
    await app.run({ path: "/other" });
    expect(events).toEqual(["guarded", "end", "end"]);
  });

  test("supports an async predicate", async () => {
    const events: string[] = [];
    const app = new Rhythm<{ allow: boolean }>().use(
      () => {
        events.push("ran");
      },
      async (ctx) => ctx.allow,
    );

    await app.run({ allow: true });
    await app.run({ allow: false });
    expect(events).toEqual(["ran"]);
  });

  test("a skipped middleware does not end the chain; later middleware still run and onion order is kept", async () => {
    const events: string[] = [];
    const app = new Rhythm<{}>()
      .use(async (_ctx, next) => {
        events.push("outer:before");
        await next();
        events.push("outer:after");
      })
      .use(
        () => {
          events.push("never");
        },
        () => false,
      )
      .use(() => {
        events.push("inner");
      });

    await app.run({});
    expect(events).toEqual(["outer:before", "inner", "outer:after"]);
  });

  test("the predicate sees startup context and earlier derive output", async () => {
    let seen: unknown;
    const app = new Rhythm<{}, { env: string }>().use(derive((ctx) => ({ label: `${ctx.env}!` }))).use(
      () => {
        seen = "ran";
      },
      (ctx) => ctx.label === "test!",
    );
    app.context.env = "test";

    await app.run({});
    expect(seen).toBe("ran");
  });

  test("a conditional derive does not widen the context type (its fields may be absent)", async () => {
    const app = new Rhythm<{ flag: boolean }>().use(
      derive(() => ({ extra: 1 })),
      (ctx) => ctx.flag,
    );
    app.use((ctx) => {
      // @ts-expect-error
      ctx.extra;
    });

    await app.run({ flag: false });
  });

  test("a throwing predicate rejects the run", async () => {
    const app = new Rhythm<{}>().use(
      () => {},
      () => {
        throw new Error("predicate failed");
      },
    );

    await expect(app.run({})).rejects.toThrow("predicate failed");
  });

  test("rejects a non-function predicate immediately", () => {
    expect(() => new Rhythm<{}>().use(() => {}, "nope" as any)).toThrow("condition must be a function!");
  });
});

describe("compose() caching", () => {
  test("middleware added after earlier run() calls is picked up on the next run", async () => {
    const events: string[] = [];
    const app = new Rhythm<{}>().use(async (ctx, next) => {
      events.push("first");
      await next();
    });

    await app.run({});
    await app.run({});

    app.use(() => {
      events.push("second");
    });
    await app.run({});

    expect(events).toEqual(["first", "first", "first", "second"]);
  });
});

describe("use() is positional across modules and mounts", () => {
  const mark =
    (events: string[], name: string): Middleware<any> =>
    async (_ctx, next) => {
      events.push(`${name}:in`);
      await next();
      events.push(`${name}:out`);
    };

  test("use().register().use().use(mount).use(): each use() wraps only what is registered after it", async () => {
    const events: string[] = [];
    const mount = new Rhythm<{}>().use(mark(events, "mount")).middleware();

    await new Rhythm<{}>()
      .use(mark(events, "a"))
      .register(new Rhythm<{}>().use(mark(events, "module")))
      .use(mark(events, "b"))
      .use(mount)
      .use(mark(events, "c"))
      .run({});

    expect(events).toEqual([
      "a:in",
      "module:in",
      "b:in",
      "mount:in",
      "c:in",
      "c:out",
      "mount:out",
      "b:out",
      "module:out",
      "a:out",
    ]);
  });

  test("a use() after register() does not run inside the registered module", async () => {
    const events: string[] = [];
    const child = new Rhythm<{}>().use(() => {
      events.push("child");
    });
    const app = new Rhythm<{}>().register(child).use(() => {
      events.push("after");
    });

    await app.run({});
    expect(events).toEqual(["child"]);
  });

  test("a use() before register() does not receive the module's inner middleware effects", async () => {
    const seen: unknown[] = [];
    const child = new Rhythm<{}>().use(async (ctx, next) => {
      (ctx as any).inner = true;
      await next();
    });
    const app = new Rhythm<{}>()
      .use(async (ctx, next) => {
        await next();
        seen.push((ctx as any).inner);
      })
      .register(child);

    await app.run({});
    expect(seen).toEqual([undefined]);
  });

  test("a registered module's middleware added after its first run is picked up on the next run", async () => {
    const events: string[] = [];
    const child = new Rhythm<{}>().use(async (_ctx, next) => {
      events.push("first");
      await next();
    });
    const app = new Rhythm<{}>().register(child);

    await app.run({});
    child.use(() => {
      events.push("second");
    });
    await app.run({});

    expect(events).toEqual(["first", "first", "second"]);
  });
});

describe("middleware()", () => {
  test("context values are merged into the same shared ctx object passed in, not a fresh one", async () => {
    const child = new Rhythm<{}, { greeting: string }>();
    child.context.greeting = "hi";
    const mw = child.middleware();

    const ctx: Record<string, unknown> = {};
    await mw(ctx as any, (async () => ctx) as any);

    expect(ctx.greeting).toBe("hi");
  });

  test("not calling next() inside the child halts the parent's downstream middleware too", async () => {
    const events: string[] = [];
    const child = new Rhythm<{}>().use(() => {
      events.push("child");
    });

    const app = new Rhythm<{}>().use(child.middleware()).use(() => {
      events.push("parent-downstream");
    });

    await app.run({});
    expect(events).toEqual(["child"]);
  });

  test("the child calling next() lets the parent's downstream middleware run", async () => {
    const events: string[] = [];
    const child = new Rhythm<{}>().use(async (ctx, next) => {
      events.push("child");
      await next();
    });

    const app = new Rhythm<{}>().use(child.middleware()).use(() => {
      events.push("parent-downstream");
    });

    await app.run({});
    expect(events).toEqual(["child", "parent-downstream"]);
  });
});

describe("sources", () => {
  test("collects tagged middleware and registered modules in order, and sets parent", () => {
    const a = {};
    const b = {};
    const tagged = (source: object): Middleware<{}> => withSource(async (_ctx, next) => void (await next()), source);
    const child = new Rhythm().use(tagged(b));
    const root = new Rhythm().use(tagged(a)).register(child);
    expect(root.sources).toEqual([a, b]);
    expect(child.parent).toBe(root);
    expect(child.sources).toEqual([b]);
  });

  test("module.middleware() carries the module as its source", () => {
    const child = new Rhythm();
    const root = new Rhythm().use(child.middleware());
    expect(child.parent).toBe(root);
  });
});
