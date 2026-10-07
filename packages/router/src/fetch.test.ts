import { test, expect, spyOn } from "bun:test";
import { Rhythm, mount } from "@rhythmjs/rhythm";
import type { RhythmHttpContext } from "./context";
import { RhythmRouter } from "./rhythm-router";
import { errorToResponse, toFetchHandler } from "./fetch";

test("toFetchHandler turns a request into a Response through the app", async () => {
  const app = new Rhythm<{}, RhythmHttpContext>().use(async (ctx, next) => {
    ctx.text(`you asked for ${new URL(ctx.request.url).pathname}`);
    await next();
  });

  const response = await toFetchHandler(app)(new Request("http://localhost/hello"));

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("you asked for /hello");
});

test("toFetchHandler gives each request its own response", async () => {
  const app = new Rhythm<{}, RhythmHttpContext>().use((ctx) => {
    ctx.text(new URL(ctx.request.url).pathname);
  });

  const fetch = toFetchHandler(app);
  const [a, b] = await Promise.all([
    fetch(new Request("http://localhost/a")),
    fetch(new Request("http://localhost/b")),
  ]);

  expect(await a.text()).toBe("/a");
  expect(await b.text()).toBe("/b");
});

test("toFetchHandler answers 404 when nothing touched the response", async () => {
  const response = await toFetchHandler(new Rhythm<{}, RhythmHttpContext>())(new Request("http://localhost/"));

  expect(response.status).toBe(404);
  expect(await response.text()).toBe("Not Found");
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
});

test("toFetchHandler keeps an intentional empty response", async () => {
  const app = new Rhythm<{}, RhythmHttpContext>().use((ctx) => {
    ctx.response.status = 204;
  });

  const response = await toFetchHandler(app)(new Request("http://localhost/"));

  expect(response.status).toBe(204);
});

test("toFetchHandler keeps a response that only set a header", async () => {
  const app = new Rhythm<{}, RhythmHttpContext>().use((ctx) => {
    ctx.response.headers.set("x-ready", "yes");
  });

  const response = await toFetchHandler(app)(new Request("http://localhost/"));

  expect(response.status).toBe(200);
  expect(response.headers.get("x-ready")).toBe("yes");
});

test("toFetchHandler works with a router, directly or mounted", async () => {
  const router = new RhythmRouter().get("/users/:id", (ctx) => {
    ctx.json({ id: ctx.params.id });
  });

  const direct = toFetchHandler(router);
  const mounted = toFetchHandler(new Rhythm<{}, RhythmHttpContext>().use(mount(router)));

  for (const fetch of [direct, mounted]) {
    const hit = await fetch(new Request("http://localhost/users/42"));
    const miss = await fetch(new Request("http://localhost/nope"));

    expect(await hit.json()).toEqual({ id: "42" });
    expect(miss.status).toBe(404);
  }
});

test("toFetchHandler lets errors from the app reject", async () => {
  const app = new Rhythm<{}, RhythmHttpContext>().use(() => {
    throw new Error("boom");
  });

  expect(toFetchHandler(app)(new Request("http://localhost/"))).rejects.toThrow("boom");
});

test("errorToResponse uses a declared 4xx status and exposes its message", async () => {
  const res = errorToResponse(Object.assign(new Error("nope"), { status: 403 }));
  expect(res.status).toBe(403);
  expect(await res.text()).toBe("nope");
});

test("errorToResponse hides the message of unexpected errors behind a 500", async () => {
  const spy = spyOn(console, "error").mockImplementation(() => {});
  const res = errorToResponse(new Error("secret"));
  expect(res.status).toBe(500);
  expect(await res.text()).toBe("Internal Server Error");
  spy.mockRestore();
});

test("errorToResponse finds the status through a wrapped cause chain", async () => {
  const wrapped = new Error('mounted router "api" failed', {
    cause: Object.assign(new Error("missing"), { status: 404 }),
  });
  const res = errorToResponse(wrapped);
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("missing");
});

test("toFetchHandler exposes the Bun server as ctx.server", async () => {
  const server = { requestIP: () => ({ address: "203.0.113.7" }) } as unknown as Bun.Server<undefined>;
  const app = new Rhythm<{}, RhythmHttpContext>().use((ctx) => {
    ctx.text(ctx.server?.requestIP(ctx.request)?.address ?? "none");
  });
  const handler = toFetchHandler(app);

  expect(await (await handler(new Request("http://localhost/"), server)).text()).toBe("203.0.113.7");
  expect(await (await handler(new Request("http://localhost/"))).text()).toBe("none");
});
