import { addRoute, createRouter, findRoute } from "rou3";
import type { RhythmHttpContext } from "@rhythmjs/router/context";
import { pathnameOf } from "./pathname";

export function pathIs(pattern: string): (ctx: RhythmHttpContext) => boolean {
  if (!pattern.startsWith("/")) throw new TypeError(`path must start with "/", got "${pattern}"`);

  const router = createRouter<true>();
  addRoute(router, "", pattern, true);

  return (ctx) => findRoute(router, ctx.request.method, pathnameOf(ctx.request.url)) !== undefined;
}
