import { join } from "node:path";
import { Rhythm } from "@rhythmjs/rhythm";
import type { RhythmHttpContext } from "@rhythmjs/router/context";
import { errorToResponse, toFetchHandler } from "@rhythmjs/router/fetch";
import { createDatabase, type Database } from "./database";
import { notesModule } from "./notes/notes.module";
import { usersModule } from "./users/users.module";

const app = new Rhythm<RhythmHttpContext, { db: Database; logger: { info(msg: string): void } }>({ name: "app" })
  .use(async (ctx, next) => {
    const startedAt = Date.now();
    await next();
    ctx.logger.info(
      `${ctx.request.method} ${new URL(ctx.request.url).pathname} ${ctx.response.status} in ${Date.now() - startedAt}ms`,
    );
  })
  .register(usersModule)
  .register(notesModule)
  .use(async (ctx) => {
    ctx.error(404);
  });

app.context.db = createDatabase();
app.context.logger = { info: (msg) => console.log(`[app] ${msg}`) };

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
