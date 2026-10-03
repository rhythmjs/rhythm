import { RhythmRouter } from "@rhythmjs/router";
import type { RhythmHttpContext } from "@rhythmjs/router/context";
import type { UsersService } from "./users.service";

export type UsersContext = RhythmHttpContext & {
  usersService: UsersService;
};

async function readName(request: Request): Promise<string | undefined> {
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  return typeof body?.name === "string" && body.name ? body.name : undefined;
}

export const usersController = new RhythmRouter<UsersContext>()
  .use(async (ctx, next) => {
    console.log(`[users]:new ${ctx.request.method} ${new URL(ctx.request.url).pathname}`);
    await next();
  })
  .get("/api/users/", (ctx) => ctx.json(ctx.usersService.list()))
  .get("/api/users/:id", (ctx) => {
    const user = ctx.usersService.get(ctx.params.id);
    if (!user) return ctx.error(404, "User not found");
    ctx.json(user);
  })
  .post("/api/users/", async (ctx) => {
    const name = await readName(ctx.request);
    if (!name) return ctx.error(400, "name is required");
    ctx.json(ctx.usersService.create(name), 201);
  })
  .put("/api/users/:id", async (ctx) => {
    const name = await readName(ctx.request);
    if (!name) return ctx.error(400, "name is required");
    const user = ctx.usersService.update(ctx.params.id, name);
    if (!user) return ctx.error(404, "User not found");
    ctx.json(user);
  })
  .delete("/api/users/:id", (ctx) => {
    if (!ctx.usersService.remove(ctx.params.id)) return ctx.error(404, "User not found");
    ctx.response.status = 204;
  });
