import type { Middleware, Next } from "./types";

const done: Promise<void> = Promise.resolve();

export function compose<T>(middleware: Middleware<T>[]) {
  const last = middleware.length;

  return (ctx: T, next?: Next): Promise<void> => {
    if (last === 0) return next ? next() : done;

    let index = -1;

    // Not `async`: a settled middleware chain costs no extra promise per layer.
    function dispatch(i: number): Promise<void> {
      if (i <= index) return Promise.reject(new Error("next() called multiple times"));
      index = i;
      const fn = i === last ? next : middleware[i];
      if (!fn) return done;
      try {
        const result = fn(ctx, () => dispatch(i + 1));
        return result instanceof Promise ? (result as Promise<void>) : Promise.resolve(result as void);
      } catch (error) {
        return Promise.reject(error);
      }
    }

    return dispatch(0);
  };
}
