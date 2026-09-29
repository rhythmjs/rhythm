import type { Middleware, NextFn } from "./types";

export function compose<TContext extends object>(middleware: Middleware<TContext>[]) {
  if (!Array.isArray(middleware)) throw new TypeError("Middleware stack must be an array!");
  for (const fn of middleware) {
    if (typeof fn !== "function") throw new TypeError("Middleware must be composed of functions!");
  }

  return function (context: TContext, next?: NextFn<TContext>): Promise<TContext> {
    let index = -1;

    return dispatch(0);

    function dispatch(i: number): Promise<TContext> {
      if (i <= index) return Promise.reject(new Error("next() called multiple times"));
      index = i;

      const fn = i === middleware.length ? next : middleware[i];
      if (!fn) return Promise.resolve(context);

      const dispatchNext: NextFn<TContext> = () => dispatch(i + 1);

      try {
        const call = fn as (ctx: TContext, next: NextFn<TContext>) => Promise<void> | void;
        return Promise.resolve(call(context, dispatchNext)).then(() => context);
      } catch (err) {
        return Promise.reject(err);
      }
    }
  };
}
