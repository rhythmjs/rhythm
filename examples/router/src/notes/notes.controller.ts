import { RhythmRouter } from "@rhythmjs/router";
import type { RhythmHttpContext } from "@rhythmjs/router/context";
import type { NotesService } from "./notes.service";
import { error, json } from "@rhythmjs/router/response";

export type NotesContext = RhythmHttpContext & {
  notesService: NotesService;
};

const apiKey = process.env.API_KEY ?? "dev-key";

export const notesController = new RhythmRouter<NotesContext>()
  .use(async (ctx, next) => {
    if (ctx.request.method !== "GET" && ctx.request.headers.get("x-api-key") !== apiKey)
      return error(ctx, 401, "x-api-key required");
    await next();
  })
  .get("/api/notes/", (ctx) => {
    json(ctx, ctx.notesService.list(new URL(ctx.request.url).searchParams.get("userId") ?? undefined));
  })
  .get("/api/notes/:id", (ctx) => {
    const note = ctx.notesService.get(ctx.params.id);
    if (!note) return error(ctx, 404, "Note not found");
    json(ctx, note);
  })
  .post("/api/notes/", async (ctx) => {
    const body = (await ctx.request.json().catch(() => null)) as { userId?: unknown; text?: unknown } | null;
    if (typeof body?.userId !== "string" || typeof body.text !== "string" || !body.text)
      return error(ctx, 400, "userId and text are required");
    const note = ctx.notesService.create(body.userId, body.text);
    if (!note) return error(ctx, 422, "Unknown user");
    json(ctx, note, 201);
  })
  .delete("/api/notes/:id", (ctx) => {
    if (!ctx.notesService.remove(ctx.params.id)) return error(ctx, 404, "Note not found");
    ctx.response.status = 204;
  });
