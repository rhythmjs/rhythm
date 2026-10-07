import type { Rhythm } from "./rhythm";

export type Next = () => Promise<void>;

export type Middleware<T> = (ctx: T, next: Next) => unknown | Promise<unknown>;

declare const extension: unique symbol;

export type Extension<U extends object> = { [extension]: U };

declare const input: unique symbol;

export type Input<I extends object> = { [input]: I };

export type MountMiddleware<I extends object> = Middleware<any> & Input<I>;

export type Unsupplied<Ctx extends object, X extends object> = {
  [K in keyof X as K extends keyof Ctx ? (Ctx[K] extends X[K] ? never : K) : K]: X[K];
};

export type WidenInput<Ctx extends object, I extends object, X extends object> = I & Unsupplied<Ctx, X>;

export type ExtensionMiddleware<T extends object, U extends object> = Middleware<T> & Extension<U>;

export type RegisterCallback<T extends object> = (ctx: T, app: Rhythm<T, any, any>) => unknown;

export type CleanupCallback<T extends object> = (ctx: T, app: Rhythm<T, any, any>) => unknown;

export type ExtensionRegister<T extends object, U extends object> = RegisterCallback<T> & Extension<U>;

export interface PipelineOptions {
  name?: string;
  type?: string;
}

export type Mountable<I extends object = any> = {
  callback(): (...input: any[]) => Promise<unknown>;
  readonly options?: PipelineOptions;
  readonly "~input"?: I;
};

export type RhythmInputArgs<I extends object> = {} extends I ? [input?: I] : [input: I];

export type RhythmHandler<I extends object, C extends object> = (...input: RhythmInputArgs<I>) => Promise<C>;
