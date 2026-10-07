import type { Middleware, Next } from "./types";

export function compose<T>(middleware: Middleware<T>[]) {
  return (ctx: T, next?: Next): Promise<void> => {
    let index = -1;

    async function dispatch(i: number): Promise<void> {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      const fn = i === middleware.length ? next : middleware[i];
      if (!fn) return;
      await fn(ctx, () => dispatch(i + 1));
    }

    return dispatch(0);
  };
}
