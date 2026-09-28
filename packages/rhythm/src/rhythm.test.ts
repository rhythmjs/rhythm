import { describe, expect, test } from "bun:test";
import { Rhythm } from "./rhythm";

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

  test("next(extra) merges into context for downstream middleware and the final result", async () => {
    const app = new Rhythm<{}>()
      .use<{ user: string }>(async (ctx, next) => {
        await next({ user: "Alice" });
      })
      .use((ctx) => {
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
    const child = new Rhythm<{}>().use<{ secret: string }>(async (ctx, next) => {
      await next({ secret: "hidden" });
    });

    let seen: unknown;
    const app = new Rhythm<{}>()
      .register(child)
      .use((ctx) => {
        seen = (ctx as Record<string, unknown>).secret;
      });

    await app.run({});
    expect(seen).toBeUndefined();
  });

  test("register(module, exportValue) opts in to promoting specific fields", async () => {
    const child = new Rhythm<{}>().use<{ secret: string }>(async (ctx, next) => {
      await next({ secret: "hidden" });
    });

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

  test("options.type overrides the default \"module\" label used in the register() error", async () => {
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
    expect(events).toEqual(["caught: boom", "app continued"]);
  });

  test.skip("type system: a non-exported field is not visible on the parent's context", () => {
    const child = new Rhythm<{}>().use<{ secret: string }>(async (ctx, next) => {
      await next({ secret: "hidden" });
    });
    new Rhythm<{}>()
      .register(child)
      .use((ctx) => {
        // @ts-expect-error default register() stays sealed - `secret` must not be visible without exportValue
        return ctx.secret;
      });
  });

  test.skip("type system: a module needing fields the parent doesn't have cannot be registered", () => {
    const needsToken = new Rhythm<{ token: string }>().use((ctx) => {
      ctx.token;
    });
    // @ts-expect-error parent context ({}) doesn't satisfy the module's required input ({ token })
    new Rhythm<{}>().register(needsToken);
  });
});

describe("ctx is DeepReadonly", () => {
  test.skip("type system: direct mutation of ctx is a type error", () => {
    new Rhythm<{ user: { name: string } }>().use((ctx) => {
      // @ts-expect-error ctx is DeepReadonly - direct mutation must be a type error
      ctx.user.name = "mutated";
    });
  });
});

describe("provide()", () => {
  test("factory runs exactly once across multiple run() calls", async () => {
    let calls = 0;
    const app = new Rhythm<{}>()
      .provide(() => {
        calls++;
        return { value: 42 };
      })
      .use((ctx) => {
        expect(ctx.value).toBe(42);
      });

    await app.run({});
    await app.run({});
    await app.run({});
    expect(calls).toBe(1);
  });

  test("later providers receive earlier ones via deps, in declaration order", async () => {
    const app = new Rhythm<{}>()
      .provide(() => ({ config: { name: "svc" } }))
      .provide((deps) => ({ label: `[${deps.config.name}]` }));

    const result = await app.run({});
    expect(result.label).toBe("[svc]");
  });

  test("concurrent run() calls during cold start all see the resolved value (regression)", async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let calls = 0;
    const app = new Rhythm<{ id: number }>()
      .provide(async () => {
        calls++;
        await sleep(20);
        return { db: { ready: true } };
      })
      .use((ctx) => {
        ctx.db;
      });

    const results = await Promise.all([app.run({ id: 1 }), app.run({ id: 2 }), app.run({ id: 3 })]);
    for (const r of results) expect(r.db).toEqual({ ready: true });
    expect(calls).toBe(1);
  });

  test("a failed provider factory can be retried on a later run()", async () => {
    let attempts = 0;
    const app = new Rhythm<{}>().provide(async () => {
      attempts++;
      if (attempts === 1) throw new Error("transient");
      return { ready: true };
    });

    await expect(app.run({})).rejects.toThrow("transient");
    const result = await app.run({});
    expect(result.ready).toBe(true);
    expect(attempts).toBe(2);
  });

  test("keys prefixed with # are stripped from context but still passed in full to dispose", async () => {
    let disposedWith: unknown;
    const app = new Rhythm<{}>()
      .provide(
        () => ({ prompt: { ask: () => "hi" }, "#close": () => {} }),
        (value) => {
          disposedWith = value;
        },
      )
      .use((ctx) => {
        expect((ctx as any)["#close"]).toBeUndefined();
        expect(ctx.prompt.ask()).toBe("hi");
      });

    await app.run({});
    await app.teardown();

    expect(disposedWith).toHaveProperty("#close");
    expect(disposedWith).toHaveProperty("prompt");
  });

  test("a plain key (no # prefix) is unaffected and reaches context as before", async () => {
    const app = new Rhythm<{}>()
      .provide(() => ({ value: 1, extra: "x" }))
      .use((ctx) => {
        expect(ctx.value).toBe(1);
        expect(ctx.extra).toBe("x");
      });

    await app.run({});
  });
});

describe("setup()/teardown()", () => {
  test("setup() cascades eagerly into registered modules", async () => {
    let childResolved = false;
    const child = new Rhythm<{}>({ name: "child" }).provide(() => {
      childResolved = true;
      return {};
    });

    const app = new Rhythm<{}>().register(child);
    await app.setup();
    expect(childResolved).toBe(true);
  });

  test("teardown() disposes in reverse of resolution order, cascading into registered modules", async () => {
    const order: string[] = [];
    const child = new Rhythm<{}>({ name: "child" }).provide(
      () => {
        order.push("open:child");
        return {};
      },
      () => {
        order.push("close:child");
      },
    );

    const app = new Rhythm<{}>()
      .provide(
        () => {
          order.push("open:parent");
          return {};
        },
        () => {
          order.push("close:parent");
        },
      )
      .register(child);

    await app.setup();
    await app.teardown();

    expect(order).toEqual(["open:parent", "open:child", "close:child", "close:parent"]);
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

describe("middleware()", () => {
  test("providers are merged into the same shared ctx object passed in, not a fresh one", async () => {
    const child = new Rhythm<{}>().provide(() => ({ greeting: "hi" }));
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
