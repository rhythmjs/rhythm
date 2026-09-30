import { join } from "node:path";
import { describe, expect, spyOn, test } from "bun:test";
import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmRouter } from "./rhythm-router";
import { errorToResponse, toFetchHandler } from "./fetch";
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

describe("errorToResponse", () => {
  test("maps unknown errors to a logged 500 and honors an error's own status", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const internal = errorToResponse(new Error("boom"));
      expect(internal.status).toBe(500);
      expect(await internal.text()).toBe("Internal Server Error");
      expect(errorSpy).toHaveBeenCalled();

      const teapot = errorToResponse(Object.assign(new Error("short and stout"), { status: 418 }));
      expect(teapot.status).toBe(418);
      expect(await teapot.text()).toBe("short and stout");
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("hand-wired Bun.serve", () => {
  test("toFetchHandler + Bun's native directory routes + errorToResponse + request.ip, no helpers", async () => {
    const publicDir = await (async () => {
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const made = await mkdtemp(join(tmpdir(), "rhythm-plain-static-"));
      await writeFile(join(made, "hello.txt"), "hello static");
      return made;
    })();

    const app = new Rhythm<RhythmHttpContext>({ name: "wired" }).use(
      new RhythmRouter()
        .get("/ping", (ctx) => ctx.text("pong"))
        .get("/ip", (ctx) => ctx.text(String((ctx.request as { ip?: string }).ip)))
        .get("/boom", () => {
          throw new Error("boom");
        })
        .middleware(),
    );
    const handler = toFetchHandler(app);

    const server = Bun.serve({
      port: 0,
      // Static files are Bun's own directory routes: content types, weak
      // ETags with 304s, ranges, and traversal rejection all built in.
      routes: { "/static/*": { dir: publicDir } },
      async fetch(request, srv) {
        Object.defineProperty(request, "ip", {
          configurable: true,
          get: () => srv.requestIP(request)?.address,
        });
        try {
          return await handler(request);
        } catch (error) {
          return errorToResponse(error);
        }
      },
    });
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const base = `http://localhost:${server.port}`;
      expect(await (await fetch(`${base}/ping`)).text()).toBe("pong");

      const file = await fetch(`${base}/static/hello.txt`);
      expect(await file.text()).toBe("hello static");
      const tag = file.headers.get("etag") as string;
      expect((await fetch(`${base}/static/hello.txt`, { headers: { "if-none-match": tag } })).status).toBe(304);
      expect((await fetch(`${base}/static/nope.txt`)).status).toBe(404);
      expect((await fetch(`${base}/static/..%2f..%2fetc%2fpasswd`)).status).toBe(404);

      expect((await fetch(`${base}/boom`)).status).toBe(500);
      const ip = await (await fetch(`${base}/ip`)).text();
      expect(ip.length).toBeGreaterThan(0);
      expect(ip).not.toBe("undefined");
    } finally {
      errorSpy.mockRestore();
      server.stop(true);
      const { rm } = await import("node:fs/promises");
      await rm(publicDir, { recursive: true, force: true });
    }
  });
});
