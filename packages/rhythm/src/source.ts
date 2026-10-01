import type { Middleware } from "./types";

const SOURCE = "~source";

export function withSource<TFn extends Middleware<any>>(fn: TFn, source: object): TFn {
  Object.defineProperty(fn, SOURCE, { value: source });
  return fn;
}

export function sourceOf(fn: unknown): object | undefined {
  if (typeof fn !== "function") return undefined;
  return (fn as unknown as Record<string, object | undefined>)[SOURCE];
}
