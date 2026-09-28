import { Rhythm } from "@rhythmjs/rhythm";
import { toFetchHandler } from "@rhythmjs/router/adapters/bun";
import type { RhythmHttpContext } from "@rhythmjs/router/adapters/context";
import { RhythmRouter } from "@rhythmjs/router";

interface User {
  id: string;
  name: string;
}

const users: Record<string, User> = {
  u1: { id: "u1", name: "Alice" },
  u2: { id: "u2", name: "Bob" },
};

const usersRouter = new RhythmRouter({ name: "users", prefix: "/users" }).get<{ user: User }>(
  "/:id",
  async (ctx, next) => {
    const user = users[ctx.params.id];
    if (!user) {
      ctx.response.status = 404;
      ctx.response.body = "Not Found";
      return;
    }
    await next({ user });
  },
  (ctx) => {
    ctx.response.headers.set("content-type", "application/json");
    ctx.response.body = JSON.stringify(ctx.user);
  },
);

const apiRouter = new RhythmRouter({ name: "api", prefix: "/api" }).use(usersRouter.routes());

const app = new Rhythm<RhythmHttpContext>({ name: "app" })
  .provide(() => ({ logger: { info: (msg: string) => console.log(`[app] ${msg}`) } }))
  .use(async (ctx, next) => {
    const startedAt = Date.now();
    await next();
    ctx.logger.info(
      `${ctx.request.method} ${new URL(ctx.request.url).pathname} - ${ctx.response.status} in ${Date.now() - startedAt}ms`,
    );
  })
  .use(apiRouter.routes())
  .use(async (ctx) => {
    ctx.response.headers.set("content-type", "text/plain");
    if (new URL(ctx.request.url).pathname === "/") {
      ctx.response.status = 200;
      ctx.response.body = "Welcome to the API!";
      return;
    }
    ctx.response.status = 404;
    ctx.response.body = "Not Found";
  });

const server = Bun.serve({ port: 3000, fetch: toFetchHandler(app) });
console.log(`listening on http://localhost:${server.port}`);
