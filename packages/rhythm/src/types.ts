export type OmitHashKeys<T> = {
  [K in keyof T as K extends `#${string}` ? never : K]: T[K];
};

export type Condition<TContext extends object> = (ctx: TContext) => boolean | Promise<boolean>;

export type NextFn<TContext extends object> = () => Promise<TContext>;

export type Middleware<TContext extends object> = (ctx: TContext, next: NextFn<TContext>) => Promise<void> | void;

export type DeriveMiddleware<TContext extends object, TExtra extends object> = Middleware<TContext> & {
  readonly "~derive": TExtra;
};
