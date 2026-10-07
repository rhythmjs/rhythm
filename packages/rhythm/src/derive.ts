import type { ExtensionMiddleware, Next } from "./types";

export function derive<U extends object, T extends object = {}>(
  factory: (ctx: T) => U | Promise<U>,
): ExtensionMiddleware<T, U> {
  const middleware = (ctx: T, next: Next) => {
    const values = factory(ctx);
    if (values instanceof Promise) {
      return values.then((resolved) => {
        Object.assign(ctx, resolved);
        return next();
      });
    }
    Object.assign(ctx, values);
    return next();
  };
  return middleware as ExtensionMiddleware<T, U>;
}
