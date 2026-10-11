import { join } from "node:path";
import { Rhythm, decorate, mount } from "@rhythmjs/rhythm";
import { type RhythmHttpContext } from "@rhythmjs/router/context";
import { error } from "@rhythmjs/router/response";
import { errorToResponse, toFetchHandler } from "@rhythmjs/router/fetch";
import { pathIs } from "@rhythmjs/router/path";
import { createDatabase } from "./database";
import { notesModule } from "./notes/notes.module";
import { usersModule } from "./users/users.module";

const isApi = pathIs("/api/**");

const app = new Rhythm<{}, RhythmHttpContext>({ name: "app" })
  .register(
    decorate(() => ({
      db: createDatabase(),
      logger: { info: (msg: string) => console.log(`[app] ${msg}`) },
    })),
  )
  .use(async (ctx, next) => {
    if (!isApi(ctx)) return next();
    const startedAt = Date.now();
    await next();
    ctx.response.headers.set("cache-control", "no-store");
    ctx.logger.info(
      `${ctx.request.method} ${new URL(ctx.request.url).pathname} ${ctx.response.status} in ${Date.now() - startedAt}ms`,
    );
  })
  .use(mount(usersModule))
  .use(mount(notesModule))
  .use((ctx) => {
    if (ctx.response.status === 200 && ctx.response.body === null) error(ctx, 404);
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
  async fetch(request, server) {
    try {
      return await handler(request, server);
    } catch (error) {
      return errorToResponse(error);
    }
  },
});

console.log(`listening on ${server.url}`);
