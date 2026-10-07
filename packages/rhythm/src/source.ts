const SOURCE = "~source";

export function withSource<F extends (...args: any[]) => unknown>(fn: F, source: object): F {
  Object.defineProperty(fn, SOURCE, { value: source });
  return fn;
}

export function sourceOf(fn: unknown): object | undefined {
  if (typeof fn !== "function") return undefined;
  return (fn as unknown as Record<string, object | undefined>)[SOURCE];
}
