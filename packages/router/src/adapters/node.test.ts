import { describe, expect, test, vi } from "vite-plus/test";
import * as http from "node:http";
import { Rhythm } from "@rhythmjs/rhythm";
import { toNodeHandler } from "./node";
import type { RhythmHttpContext } from "./context";

async function withServer<TContext extends RhythmHttpContext, TProviders extends object>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(toNodeHandler(app));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await run(`http://localhost:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("toNodeHandler()", () => {
  test("ctx.response is seeded up front and mutated directly, koa-style", async () => {
    const app = new Rhythm<RhythmHttpContext>().use((ctx) => {
      ctx.response.status = 201;
      ctx.response.headers.set("x-custom", "yes");
      ctx.response.body = "created";
    });

    await withServer(app, async (base) => {
      const res = await fetch(base);
      expect(res.status).toBe(201);
      expect(res.headers.get("x-custom")).toBe("yes");
      expect(await res.text()).toBe("created");
    });
  });

  test("defaults to an empty 200 response when no middleware touches it", async () => {
    const app = new Rhythm<RhythmHttpContext>().use(() => {});

    await withServer(app, async (base) => {
      const res = await fetch(base);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("");
    });
  });

  test("the incoming request's method, url, and headers are readable on ctx.request", async () => {
    const app = new Rhythm<RhythmHttpContext>().use((ctx) => {
      const url = new URL(ctx.request.url);
      ctx.response.body = JSON.stringify({
        method: ctx.request.method,
        path: url.pathname,
        custom: ctx.request.headers.get("x-test"),
      });
    });

    await withServer(app, async (base) => {
      const res = await fetch(`${base}/hello`, { headers: { "x-test": "yep" } });
      expect(await res.json()).toEqual({ method: "GET", path: "/hello", custom: "yep" });
    });
  });

  test("a POST body is readable on ctx.request", async () => {
    const app = new Rhythm<RhythmHttpContext>().use(async (ctx) => {
      const text = await ctx.request.text();
      ctx.response.body = `echo: ${text}`;
    });

    await withServer(app, async (base) => {
      const res = await fetch(base, { method: "POST", body: "hello from node" });
      expect(await res.text()).toBe("echo: hello from node");
    });
  });

  test("an error thrown in a handler is answered with a 500 and doesn't crash the server", async () => {
    let calls = 0;
    const app = new Rhythm<RhythmHttpContext>().use((ctx) => {
      calls++;
      if (calls === 1) throw new Error("boom");
      ctx.response.body = "ok";
    });

    await withServer(app, async (base) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const failed = await fetch(base);
        expect(failed.status).toBe(500);
        expect(await failed.text()).toBe("Internal Server Error");

        const ok = await fetch(base);
        expect(ok.status).toBe(200);
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  test("bodyLimit: false opts out of buffering, streaming ctx.request's body over the raw connection", async () => {
    const app = new Rhythm<RhythmHttpContext>().use(async (ctx) => {
      expect(ctx.request.body).toBeInstanceOf(ReadableStream);
      const text = await ctx.request.text();
      ctx.response.body = `streamed ${text.length} bytes`;
    });
    const server = http.createServer(toNodeHandler(app, { bodyLimit: false }));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const base = `http://localhost:${port}`;

      const big = new Uint8Array(2 * 1024 * 1024).fill(65);
      const res = await fetch(base, { method: "POST", body: big });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(`streamed ${big.length} bytes`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("a body over the configured limit is rejected with 413, without crashing the server", async () => {
    const app = new Rhythm<RhythmHttpContext>().use(() => {});
    const server = http.createServer(toNodeHandler(app, { bodyLimit: 1024 }));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const base = `http://localhost:${port}`;

      const tooBig = await fetch(base, { method: "POST", body: new Uint8Array(2048) });
      expect(tooBig.status).toBe(413);

      const ok = await fetch(base);
      expect(ok.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("an unread request body doesn't stall the next request on a keep-alive connection", async () => {
    const app = new Rhythm<RhythmHttpContext>().use((ctx) => {
      ctx.response.body = "ok";
    });
    const server = http.createServer(toNodeHandler(app, { bodyLimit: 10 * 1024 * 1024 }));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      await new Promise<void>((resolve, reject) => {
        const req = http.request({ host: "localhost", port, method: "POST", agent }, (res) => {
          res.resume();
          res.on("end", resolve);
        });
        req.on("error", reject);
        req.end(new Uint8Array(5 * 1024 * 1024).fill(65));
      });

      await new Promise<void>((resolve, reject) => {
        const req = http.request({ host: "localhost", port, method: "GET", agent }, (res) => {
          res.resume();
          res.on("end", resolve);
        });
        req.on("error", reject);
        req.setTimeout(2000, () => req.destroy(new Error("timed out waiting for keep-alive response")));
        req.end();
      });
    } finally {
      agent.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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

    await withServer(app, async (base) => {
      const [first, second] = await Promise.all([fetch(base), fetch(base)]);
      expect(await first.text()).toBe("hi");
      expect(await second.text()).toBe("hi");
      expect(calls).toBe(1);
    });
  });
});
