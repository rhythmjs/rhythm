import type { ExtensionRegister } from "./types";

export function decorate<U extends object, T extends object = {}>(
  factory: (ctx: T) => U | Promise<U>,
): ExtensionRegister<T, U> {
  const callback = (ctx: T) => {
    const values = factory(ctx);
    if (values instanceof Promise) {
      return values.then((resolved) => {
        Object.assign(ctx, resolved);
      });
    }
    Object.assign(ctx, values);
  };
  return callback as unknown as ExtensionRegister<T, U>;
}
