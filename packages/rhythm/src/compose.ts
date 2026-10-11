import type { MaybePromise, Middleware, Next } from "./types";

export function compose<T>(middleware: Middleware<T>[]) {
  const last = middleware.length;

  return (ctx: T, next?: Next): MaybePromise<void> => {
    if (last === 0) return next ? next() : undefined;

    let index = -1;

    function dispatch(i: number): MaybePromise<void> {
      if (i <= index) return Promise.reject(new Error("next() called multiple times"));
      index = i;
      const fn = i === last ? next : middleware[i];
      if (!fn) return;
      try {
        const result = fn(ctx, () => dispatch(i + 1));
        if (result instanceof Promise) return result as Promise<void>;
        if (result !== null && typeof result === "object" && typeof (result as PromiseLike<void>).then === "function")
          return Promise.resolve(result as PromiseLike<void>);
      } catch (error) {
        return Promise.reject(error);
      }
    }

    return dispatch(0);
  };
}
