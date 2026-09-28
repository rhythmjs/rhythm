import { describe, expect, test } from "bun:test";
import { Rhythm } from "../../core/rhythm";
import { toFetchHandler } from "./bun";
import type { RhythmHttpContext } from "./context";

describe("toFetchHandler()", () => {
  test("ctx.response is seeded up front and mutated directly, koa-style", async () => {
    const app = new Rhythm<RhythmHttpContext>().use((ctx) => {
      ctx.response.status = 201;
      ctx.response.headers.set("x-custom", "yes");
      ctx.response.body = "created";
    });

    const res = await toFetchHandler(app)(new Request("http://localhost/"));

    expect(res.status).toBe(201);
    expect(res.headers.get("x-custom")).toBe("yes");
    expect(await res.text()).toBe("created");
  });

  test("defaults to an empty 200 response when no middleware touches it", async () => {
    const app = new Rhythm<RhythmHttpContext>().use(() => {});
    const res = await toFetchHandler(app)(new Request("http://localhost/"));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  test("outer middleware can read and adjust the response an inner middleware set, since it's the same mutable object", async () => {
    const app = new Rhythm<RhythmHttpContext>()
      .use(async (ctx, next) => {
        await next();
        ctx.response.headers.set("x-onion", `outer-saw-${ctx.response.status}`);
      })
      .use((ctx) => {
        ctx.response.status = 404;
        ctx.response.body = "not found";
      });

    const res = await toFetchHandler(app)(new Request("http://localhost/"));

    expect(res.status).toBe(404);
    expect(res.headers.get("x-onion")).toBe("outer-saw-404");
    expect(await res.text()).toBe("not found");
  });

  test("providers resolve once and are available on the request context", async () => {
    let calls = 0;
    const app = new Rhythm<RhythmHttpContext>()
      .provide(() => {
        calls++;
        return { greeting: "hi" };
      })
      .use((ctx) => {
        ctx.response.body = ctx.greeting;
      });

    const handler = toFetchHandler(app);
    const [first, second] = await Promise.all([
      handler(new Request("http://localhost/")),
      handler(new Request("http://localhost/")),
    ]);

    expect(await first.text()).toBe("hi");
    expect(await second.text()).toBe("hi");
    expect(calls).toBe(1);
  });
});
