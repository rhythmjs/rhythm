import { Rhythm } from "./core/rhythm";
import { toFetchHandler, type RhythmHttpContext } from "./adapters/bun";

interface User {
  id: string;
  name: string;
}

const users: Record<string, User> = {
  u1: { id: "u1", name: "Alice" },
  u2: { id: "u2", name: "Bob" },
};

const app = new Rhythm<RhythmHttpContext>()
  .provide(() => ({ logger: { info: (msg: string) => console.log(`[app] ${msg}`) } }))
  .use(async (ctx, next) => {
    const startedAt = Date.now();
    await next();
    ctx.logger.info(`${ctx.request.method} ${new URL(ctx.request.url).pathname} - ${ctx.response.status} in ${Date.now() - startedAt}ms`);
  })
  .use((ctx) => {
    const userId = new URL(ctx.request.url).pathname.slice(1);
    const user = users[userId];

    if (!user) {
      ctx.response.status = 404;
      ctx.response.body = "Not Found";
      return;
    }

    ctx.response.headers.set("content-type", "application/json");
    ctx.response.body = JSON.stringify(user);
  });

const server = Bun.serve({ port: 3000, fetch: toFetchHandler(app) });
console.log(`listening on http://localhost:${server.port}`);
