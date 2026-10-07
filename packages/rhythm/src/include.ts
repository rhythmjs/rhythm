import { wrapFailure } from "./failure";
import type { Rhythm } from "./rhythm";
import { withSource } from "./source";
import type { ExtensionRegister, RegisterCallback } from "./types";

export function include<
  S extends object,
  I extends object,
  D extends object,
  T extends object = {},
  U extends object = {},
>(plugin: Rhythm<S, I, D> & (T extends I ? unknown : never), select: (child: S & I & D) => U): ExtensionRegister<T, U>;
export function include<I extends object = {}, T extends object = {}>(
  plugin: Rhythm<any, I, any> & (T extends I ? unknown : never),
): RegisterCallback<T>;
export function include(plugin: Rhythm<any, any, any>, select?: (child: any) => object): unknown {
  const callback = (ctx: any, app: Rhythm<any, any, any>) => {
    app.register(
      () => {},
      () => plugin.stop(),
    );
    const done = plugin
      .callback()(ctx)
      .catch((cause: unknown) => {
        throw wrapFailure("included", plugin, cause);
      });
    if (!select) return done;
    return done.then((child) => {
      Object.assign(ctx, select(child));
    });
  };
  return withSource(callback, plugin);
}
