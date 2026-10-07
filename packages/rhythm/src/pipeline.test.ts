import { test, expect } from "bun:test";
import { Pipeline } from "./pipeline";
import { Rhythm } from "./rhythm";
import { mount } from "./mount";

type LogCtx = { log: string[] };

class Recorder extends Pipeline<LogCtx> {
  override callback() {
    const run = this.chain();
    return async (ctx: LogCtx) => {
      await run(ctx);
      return ctx;
    };
  }
}

test("a subclass only needs to implement callback()", async () => {
  const recorder = new Recorder()
    .use(async (ctx, next) => {
      ctx.log.push("in");
      await next();
      ctx.log.push("out");
    })
    .use((ctx) => {
      ctx.log.push("handler");
    });

  const ctx = await recorder.callback()({ log: [] });

  expect(ctx.log).toEqual(["in", "handler", "out"]);
});

test("use returns this, so calls chain on the subclass", () => {
  const recorder = new Recorder();

  expect(recorder.use(() => {})).toBe(recorder);
});

test("callback() snapshots the chain; later use() is not included", async () => {
  const recorder = new Recorder().use((ctx, next) => {
    ctx.log.push("first");
    return next();
  });

  const handler = recorder.callback();
  recorder.use((ctx) => {
    ctx.log.push("second");
  });

  const stale = await handler({ log: [] });
  const fresh = await recorder.callback()({ log: [] });

  expect(stale.log).toEqual(["first"]);
  expect(fresh.log).toEqual(["first", "second"]);
});

test("each instance keeps its own chain", async () => {
  const a = new Recorder().use((ctx) => void ctx.log.push("a"));
  const b = new Recorder().use((ctx) => void ctx.log.push("b"));

  expect((await a.callback()({ log: [] })).log).toEqual(["a"]);
  expect((await b.callback()({ log: [] })).log).toEqual(["b"]);
});

test("Rhythm is a Pipeline", () => {
  expect(new Rhythm()).toBeInstanceOf(Pipeline);
});

test("any Pipeline subclass can be mounted", async () => {
  const recorder = new Recorder().use((ctx) => {
    ctx.log.push("from recorder");
  });

  const app = new Rhythm().use(mount(recorder));
  const ctx = { log: [] as string[] };
  await app.callback()(ctx);

  expect(ctx.log).toEqual(["from recorder"]);
});
