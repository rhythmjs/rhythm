export const RhythmMutable: unique symbol = Symbol("RhythmMutable");

export type DeepReadonly<T> = T extends (...args: any[]) => any
  ? T
  : T extends ReadonlyArray<infer U>
    ? readonly DeepReadonly<U>[]
    : T extends Map<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends Set<infer U>
        ? ReadonlySet<DeepReadonly<U>>
        : T extends { readonly [RhythmMutable]: true }
          ? T
          : T extends object
            ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
            : T;

export type OmitHashKeys<T> = {
  [K in keyof T as K extends `#${string}` ? never : K]: T[K];
};

export type NextFn<TContext extends object> = {
  (): Promise<DeepReadonly<TContext>>;
  <TExtra extends object>(extra: TExtra): Promise<DeepReadonly<TContext & TExtra>>;
};

export type Middleware<TContext extends object> = (
  ctx: DeepReadonly<TContext>,
  next: NextFn<TContext>,
) => Promise<void> | void;
