import { wrapFailure } from "./failure";
import { withSource } from "./source";
import type { Input, Middleware, MountMiddleware, Mountable } from "./types";

export function mount<I extends object>(plugin: Mountable<I>): MountMiddleware<I>;
export function mount<T extends object = {}, I extends object = any>(
  plugin: Mountable<I> & (T extends I ? unknown : never),
  condition: (ctx: T) => boolean,
): Middleware<T> & Input<T>;
export function mount(plugin: Mountable, condition?: (ctx: any) => boolean): unknown {
  const handler = plugin.callback();
  const middleware: Middleware<any> = async (ctx: any, next) => {
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
