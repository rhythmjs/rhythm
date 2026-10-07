import { describe, expect, test } from "bun:test";
import { compose } from "./compose";

describe("compose()", () => {
  test("runs middleware onion-style", async () => {
    const log: string[] = [];
    const run = compose<object>([
      async (_, next) => {
        log.push("a:before");
        await next();
        log.push("a:after");
      },
      async (_, next) => {
        log.push("b:before");
        await next();
        log.push("b:after");
      },
    ]);
    await run({});
    expect(log).toEqual(["a:before", "b:before", "b:after", "a:after"]);
  });

  test("a middleware that skips next() stops the chain", async () => {
    const log: string[] = [];
    await compose<object>([() => void log.push("a"), () => void log.push("b")])({});
    expect(log).toEqual(["a"]);
  });

  test("calls the outer next after the last middleware", async () => {
    const log: string[] = [];
    await compose<object>([(_, next) => next()])({}, async () => void log.push("outer"));
    expect(log).toEqual(["outer"]);
  });

  test("rejects when next() is called twice", async () => {
    const run = compose<object>([
      async (_, next) => {
        await next();
        await next();
      },
      () => {},
    ]);
    await expect(run({})).rejects.toThrow("next() called multiple times");
  });

  test("propagates errors", async () => {
    const run = compose<object>([
      () => {
        throw new Error("boom");
      },
    ]);
    await expect(run({})).rejects.toThrow("boom");
  });
});
