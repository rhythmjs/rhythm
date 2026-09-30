import { describe, expect, test } from "bun:test";
import { compose } from "./compose";
import type { NextFn } from "./types";

describe("compose()", () => {
  test("rejects a non-array stack and non-function middleware eagerly, at compose time", () => {
    expect(() => compose(undefined as any)).toThrow("Middleware stack must be an array!");
    expect(() => compose([undefined as any])).toThrow("Middleware must be composed of functions!");
  });

  test("an empty stack resolves with the same context object, unchanged", async () => {
    const ctx = { a: 1 };
    const result = await compose<{ a: number }>([])(ctx);
    expect(result).toBe(ctx);
    expect(result).toEqual({ a: 1 });
  });

  test("runs middleware in onion order around next()", async () => {
    const order: string[] = [];
    const fn = compose<{}>([
      async (ctx, next) => {
        order.push("a:before");
        await next();
        order.push("a:after");
      },
      async (ctx, next) => {
        order.push("b:before");
        await next();
        order.push("b:after");
      },
      () => {
        order.push("c");
      },
    ]);

    await fn({});
    expect(order).toEqual(["a:before", "b:before", "c", "b:after", "a:after"]);
  });

  test("next() takes no arguments: every middleware shares the same context object", async () => {
    const fn = compose<{ seen: string[] }>([
      async (ctx, next) => {
        const downstream = await next();
        expect(downstream).toBe(ctx);
      },
      (ctx) => {
        ctx.seen.push("b");
      },
    ]);

    const ctx = { seen: ["a"] };
    const result = await fn(ctx);
    expect(result).toBe(ctx);
    expect(ctx.seen).toEqual(["a", "b"]);
  });

  test("not calling next() short-circuits the rest of the stack", async () => {
    const order: string[] = [];
    const fn = compose<{}>([
      () => {
        order.push("first");
      },
      () => {
        order.push("unreached");
      },
    ]);

    await fn({});
    expect(order).toEqual(["first"]);
  });

  test("calling next() twice rejects", async () => {
    const fn = compose<{}>([
      async (ctx, next) => {
        await next();
        await next();
      },
    ]);

    await expect(fn({})).rejects.toThrow("next() called multiple times");
  });

  test("a synchronous throw becomes a rejection, same as an async one", async () => {
    const sync = compose<{}>([
      () => {
        throw new Error("sync boom");
      },
    ]);
    const async_ = compose<{}>([
      async () => {
        throw new Error("async boom");
      },
    ]);

    await expect(sync({})).rejects.toThrow("sync boom");
    await expect(async_({})).rejects.toThrow("async boom");
  });

  test("the outer next runs when the stack is exhausted, enabling mounting", async () => {
    const order: string[] = [];
    const fn = compose<{}>([
      async (ctx, next) => {
        order.push("inner:before");
        await next();
        order.push("inner:after");
      },
    ]);

    const outer = (async () => {
      order.push("outer");
      return {};
    }) as NextFn<{}>;

    await fn({}, outer);
    expect(order).toEqual(["inner:before", "outer", "inner:after"]);
  });

  test("without an outer next the exhausted stack just resolves", async () => {
    const fn = compose<{ a: number }>([
      async (ctx, next) => {
        await next();
      },
    ]);

    const result = await fn({ a: 1 });
    expect(result).toEqual({ a: 1 });
  });
});
