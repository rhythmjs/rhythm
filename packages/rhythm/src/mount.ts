import { wrapFailure } from "./failure";
import { withSource } from "./source";
import type { Middleware, Mountable } from "./types";

export function mount<T extends object = {}, I extends object = any>(
  plugin: Mountable<I> & (T extends I ? unknown : never),
  condition?: (ctx: T) => boolean,
): Middleware<T> {
  const handler = plugin.callback();
  const middleware: Middleware<T> = async (ctx, next) => {
    if (!condition || condition(ctx)) {
      try {
        await handler(ctx);
      } catch (cause) {
        throw wrapFailure("mounted", plugin, cause);
      }
    }
    await next();
  };
  return withSource(middleware, plugin);
}
