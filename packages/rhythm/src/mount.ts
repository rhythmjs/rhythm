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
  const wrap = (cause: unknown): never => {
    throw wrapFailure("mounted", plugin, cause);
  };
  const middleware: Middleware<any> = (ctx: any, next) => {
    try {
      if (condition && !condition(ctx)) return next();
    } catch (cause) {
      return Promise.reject(cause);
    }
    try {
      return handler(ctx).then(() => next(), wrap);
    } catch (cause) {
      return Promise.reject(wrapFailure("mounted", plugin, cause));
    }
  };
  return withSource(middleware, plugin);
}
