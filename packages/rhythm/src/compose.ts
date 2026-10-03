import type { Condition, DeriveMiddleware, Middleware, NextFn } from "./types";

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

type ContextOf<M> = M extends Middleware<infer C> ? C : never;

type ExtraOf<M> = M extends DeriveMiddleware<any, infer E> ? E : {};

export type ComposedMiddleware<TContext extends object, TExtra extends object> = ((
  context: TContext,
  next?: NextFn<TContext>,
) => Promise<TContext>) &
  Middleware<TContext> & {
    readonly "~derive": TExtra;
  };

const toVoid = (): void => {};

export function gate<TContext extends object>(
  fn: Middleware<TContext>,
  condition: Condition<TContext>,
): Middleware<TContext> {
  if (typeof condition !== "function") throw new TypeError("condition must be a function!");
  return (ctx, next) => {
    const pass = condition(ctx);
    if (typeof pass === "boolean") return pass ? fn(ctx, next) : next().then(toVoid);
    return pass.then((ok) => (ok ? fn(ctx, next) : next().then(toVoid)));
  };
}

export function compose<const TMiddleware extends readonly Middleware<any>[]>(
  middleware: TMiddleware,
): ComposedMiddleware<
  UnionToIntersection<ContextOf<TMiddleware[number]>> & {},
  UnionToIntersection<ExtraOf<TMiddleware[number]>> & {}
>;
export function compose<TContext extends object>(
  middleware: Middleware<TContext>[],
): (context: TContext, next?: NextFn<TContext>) => Promise<TContext>;
export function compose(middleware: readonly Middleware<any>[]): any {
  if (!Array.isArray(middleware)) throw new TypeError("Middleware stack must be an array!");
  for (const fn of middleware) {
    if (typeof fn !== "function") throw new TypeError("Middleware must be composed of functions!");
  }

  return function (context: any, next?: NextFn<any>): Promise<any> {
    let index = -1;

    return dispatch(0);

    function dispatch(i: number): Promise<any> {
      if (i <= index) return Promise.reject(new Error("next() called multiple times"));
      index = i;

      const fn = i === middleware.length ? next : middleware[i];
      if (!fn) return Promise.resolve(context);

      const dispatchNext: NextFn<any> = () => dispatch(i + 1);

      try {
        const call = fn as (ctx: any, next: NextFn<any>) => Promise<void> | void;
        return Promise.resolve(call(context, dispatchNext)).then(() => context);
      } catch (err) {
        return Promise.reject(err);
      }
    }
  };
}
