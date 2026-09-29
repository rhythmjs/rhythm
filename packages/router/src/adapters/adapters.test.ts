import { describe, expect, test, vi } from "vite-plus/test";
import * as http from "node:http";
import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmRouter } from "../rhythm-router";
import type { RhythmHttpContext } from "../context";
import { handle as handleNode } from "./node";
import { handle as handleBun } from "./bun";
import { handle as handleDeno } from "./deno";
import { handle as handleVercel } from "./vercel";
import { handle as handleNetlify } from "./netlify";
import { handle as handleCloudflare } from "./cloudflare";
import { handle as handleLambda } from "./aws-lambda";
import { handle as handleServiceWorker } from "./service-worker";

function makeApp() {
  const router = new RhythmRouter()
    .get("/ping", (ctx) => ctx.text("pong"))
    .get("/users/:id", (ctx) => ctx.json({ id: ctx.params.id }))
    .post("/users", async (ctx) => {
      const body = (await ctx.request.json()) as { name: string };
      ctx.json({ id: 1, name: body.name }, 201);
    });
  return new Rhythm<RhythmHttpContext>({ name: "adapter-test" }).use(router.middleware());
}

describe("fetch-shaped adapters (bun, deno, vercel)", () => {
  test("handle() returns a working (Request) => Response handler", async () => {
    for (const handle of [handleBun, handleDeno, handleVercel]) {
      const handler = handle(makeApp());
      const res = await handler(new Request("http://localhost/users/42"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "42" });
    }
  });
});

describe("node handle()", () => {
  test("serves over node:http with params and JSON bodies", async () => {
    const server = http.createServer(handleNode(makeApp()) as http.RequestListener);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const base = `http://localhost:${port}`;
    try {
      expect(await (await fetch(`${base}/ping`)).text()).toBe("pong");
      const created = await fetch(`${base}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ada" }),
      });
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ id: 1, name: "Ada" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("reading a body over maxRequestBodySize is answered with 413, errors with 500", async () => {
    const app = new Rhythm<RhythmHttpContext>().use(async (ctx) => {
      if (new URL(ctx.request.url).pathname === "/boom") throw new Error("boom");
      await ctx.request.text();
      ctx.text("read");
    });
    const server = http.createServer(handleNode(app, { maxRequestBodySize: 16 }) as http.RequestListener);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const base = `http://localhost:${port}`;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const tooBig = await fetch(base, { method: "POST", body: "x".repeat(64) });
      expect(tooBig.status).toBe(413);

      const failed = await fetch(`${base}/boom`);
      expect(failed.status).toBe(500);

      const ok = await fetch(base, { method: "POST", body: "tiny" });
      expect(ok.status).toBe(200);
    } finally {
      errorSpy.mockRestore();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("cloudflare and netlify handle()", () => {
  test("cloudflare exposes env and context on request.runtime", async () => {
    let seenRuntime: unknown;
    const app = new Rhythm<RhythmHttpContext>().use((ctx) => {
      seenRuntime = (ctx.request as { runtime?: unknown }).runtime;
      ctx.json({ ok: true });
    });
    const env = { KV: "binding" };
    const cfCtx = { waitUntil: () => {} };
    const res = await handleCloudflare(app)(new Request("http://worker.local/"), env, cfCtx);
    expect(await res.json()).toEqual({ ok: true });
    expect(seenRuntime).toEqual({ name: "cloudflare", cloudflare: { env, context: cfCtx } });
  });

  test("netlify exposes context on request.runtime", async () => {
    let seenRuntime: unknown;
    const app = new Rhythm<RhythmHttpContext>().use((ctx) => {
      seenRuntime = (ctx.request as { runtime?: unknown }).runtime;
      ctx.text("edge");
    });
    const context = { geo: { city: "Lahore" } };
    const res = await handleNetlify(app)(new Request("http://edge.local/"), context);
    expect(await res.text()).toBe("edge");
    expect(seenRuntime).toEqual({ name: "netlify", netlify: { context } });
  });
});

describe("aws-lambda handle()", () => {
  test("answers API Gateway v1 and v2 events", async () => {
    const handler = handleLambda(makeApp());
    const context = {} as never;

    const v1 = (await handler(
      { httpMethod: "GET", path: "/ping", headers: { host: "api.example.com" } } as never,
      context,
    )) as { statusCode: number; body?: string };
    expect(v1.statusCode).toBe(200);
    expect(v1.body).toBe("pong");

    const v2 = (await handler(
      {
        version: "2.0",
        rawPath: "/users",
        rawQueryString: "",
        headers: { host: "api.example.com", "content-type": "application/json" },
        requestContext: { http: { method: "POST", path: "/users" } },
        body: JSON.stringify({ name: "Ada" }),
      } as never,
      context,
    )) as { statusCode: number; body?: string };
    expect(v2.statusCode).toBe(201);
    expect(JSON.parse(v2.body ?? "")).toEqual({ id: 1, name: "Ada" });
  });
});

describe("service-worker handle()", () => {
  test("responds to a fetch event via respondWith", async () => {
    const app = new Rhythm<RhythmHttpContext>().use((ctx) => ctx.json({ sw: true }));
    let responded: Promise<Response> | Response | undefined;
    handleServiceWorker(app)({
      request: new Request("http://sw.local/"),
      respondWith(response) {
        responded = response;
      },
    });
    const response = await responded!;
    expect(await response.json()).toEqual({ sw: true });
  });
});
