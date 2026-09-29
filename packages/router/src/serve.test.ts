import { describe, expect, test, vi } from "vite-plus/test";
import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmRouter } from "./rhythm-router";
import { serve, type RhythmServeOptions, type Server } from "./serve";
import type { RhythmHttpContext } from "./context";

function makeApp() {
  const router = new RhythmRouter()
    .get("/ping", (ctx) => ctx.text("pong"))
    .get("/users/:id", (ctx) => ctx.json({ id: ctx.params.id }))
    .post("/users", async (ctx) => {
      const body = (await ctx.request.json()) as { name: string };
      ctx.json({ id: 1, name: body.name }, 201);
    });
  return new Rhythm<RhythmHttpContext>({ name: "serve-test" }).use(router.middleware());
}

async function withServer(
  app: ReturnType<typeof makeApp>,
  options: RhythmServeOptions,
  run: (base: string, server: Server) => Promise<void>,
): Promise<void> {
  const server = serve(app, { port: 0, silent: true, ...options });
  await server.ready();
  const address = (server as { node?: { server?: { address(): unknown } } }).node?.server?.address();
  const port = typeof address === "object" && address !== null ? (address as { port: number }).port : 0;
  try {
    await run(`http://localhost:${port}`, server);
  } finally {
    await server.close();
  }
}

describe("serve()", () => {
  test("serves a rhythm app with routing, params, and JSON bodies", async () => {
    await withServer(makeApp(), {}, async (base) => {
      const ping = await fetch(`${base}/ping`);
      expect(ping.status).toBe(200);
      expect(await ping.text()).toBe("pong");

      const user = await fetch(`${base}/users/42`);
      expect(await user.json()).toEqual({ id: "42" });

      const created = await fetch(`${base}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ada" }),
      });
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ id: 1, name: "Ada" });
    });
  });

  test("reading a body over maxRequestBodySize is answered with 413", async () => {
    await withServer(makeApp(), { maxRequestBodySize: 32 }, async (base) => {
      const tooBig = await fetch(`${base}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x".repeat(128) }),
      });
      expect(tooBig.status).toBe(413);

      const ok = await fetch(`${base}/ping`);
      expect(ok.status).toBe(200);
    });
  });

  test("a thrown handler error is answered with 500, without crashing the server", async () => {
    const app = new Rhythm<RhythmHttpContext>().use((ctx) => {
      if (new URL(ctx.request.url).pathname === "/boom") throw new Error("boom");
      ctx.text("ok");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await withServer(app as ReturnType<typeof makeApp>, {}, async (base) => {
        const failed = await fetch(`${base}/boom`);
        expect(failed.status).toBe(500);
        expect(await failed.text()).toBe("Internal Server Error");

        const ok = await fetch(`${base}/fine`);
        expect(ok.status).toBe(200);
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("cors is a srvx middleware: preflights short-circuit, responses get headers", async () => {
    const cors: import("srvx").ServerMiddleware = async (request, next) => {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET,POST",
          },
        });
      }
      const response = await next();
      response.headers.set("access-control-allow-origin", "*");
      return response;
    };

    await withServer(makeApp(), { middleware: [cors] }, async (base) => {
      const preflight = await fetch(`${base}/users`, { method: "OPTIONS" });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-methods")).toBe("GET,POST");

      const res = await fetch(`${base}/ping`);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(await res.text()).toBe("pong");
    });
  });

  test("plugins receive the srvx server, the hook for websockets and similar", async () => {
    let pluginServer: Server | undefined;
    const plugin = (server: Server): void => {
      pluginServer = server;
    };

    await withServer(makeApp(), { plugins: [plugin] }, async (base, server) => {
      expect(pluginServer).toBe(server);
      const nodeServer = (pluginServer as { node?: { server?: { listening: boolean } } } | undefined)?.node?.server;
      expect(nodeServer?.listening).toBe(true);
      expect((await fetch(`${base}/ping`)).status).toBe(200);
    });
  });
});
