import { join } from "node:path";
import { Rhythm } from "@rhythmjs/rhythm";
import type { RhythmHttpContext } from "@rhythmjs/router/context";
import { errorToResponse, toFetchHandler } from "@rhythmjs/router/fetch";
import { RhythmRouter } from "@rhythmjs/router";

interface User {
  id: string;
  name: string;
}

const users: Record<string, User> = {
  u1: { id: "u1", name: "Alice" },
  u2: { id: "u2", name: "Bob" },
};

const usersRouter = new RhythmRouter({ prefix: "/api/users" }).get("/:id", (ctx) => {
  const user = users[ctx.params.id];
  if (!user) {
    ctx.error(404);
    return;
  }
  ctx.json(user);
});

const apiRouter = new RhythmRouter().use(usersRouter.middleware());

const app = new Rhythm<RhythmHttpContext>({ name: "app" })
  .provide(() => ({ logger: { info: (msg: string) => console.log(`[app] ${msg}`) } }))
  .use(async (ctx, next) => {
    const startedAt = Date.now();
    await next();
    ctx.logger.info(
      `${ctx.request.method} ${new URL(ctx.request.url).pathname} ${ctx.response.status} in ${Date.now() - startedAt}ms`,
    );
  })
  .use(apiRouter.middleware())
  .use(async (ctx) => {
    ctx.error(404);
  });

const handler = toFetchHandler(app);
const publicDir = join(import.meta.dirname, "..", "public");
const assetsDir = join(import.meta.dirname, "..", "assets");

const server = Bun.serve({
  port: 3000,
  routes: {
    "/": new Response(Bun.file(join(publicDir, "index.html"))),
    "/assets/*": { dir: assetsDir },
  },
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

console.log(`listening on ${server.url}`);
