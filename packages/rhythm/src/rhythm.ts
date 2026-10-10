import { Pipeline } from "./pipeline";
import { sourceOf } from "./source";
import type {
  CleanupCallback,
  ExtensionMiddleware,
  ExtensionRegister,
  Middleware,
  MountMiddleware,
  PipelineOptions,
  RegisterCallback,
  RhythmHandler,
  WidenInput,
} from "./types";

export { compose } from "./compose";
export { decorate } from "./decorate";
export { derive } from "./derive";
export { include } from "./include";
export { mount } from "./mount";
export { Pipeline } from "./pipeline";
export { sourceOf, withSource } from "./source";
export type * from "./types";

export class Rhythm<S extends object = {}, I extends object = {}, D extends object = {}> extends Pipeline<S & I & D> {
  declare readonly "~input"?: I;

  #ctx = {} as S;
  #cleanups: (() => unknown)[] = [];
  #ready?: Promise<unknown>;
  #tail?: Promise<unknown>;

  protected override readonly transparent = true;

  constructor(options?: PipelineOptions) {
    super({ type: "module", ...options });
  }

  register<U extends object>(callback: ExtensionRegister<S, U>, cleanup?: CleanupCallback<S & U>): Rhythm<S & U, I, D>;
  register(callback: RegisterCallback<S>, cleanup?: CleanupCallback<S>): this;
  register(callback: RegisterCallback<S>, cleanup?: CleanupCallback<any>) {
    this.adopt(sourceOf(callback));
    if (this.#tail) {
      this.#track(this.#tail.then(() => callback(this.#ctx, this)));
    } else {
      const result = callback(this.#ctx, this);
      if (result instanceof Promise) this.#track(result);
    }
    if (cleanup) {
      this.#cleanups.push(() => cleanup(this.#ctx, this));
    }
    return this;
  }

  #track(pending: Promise<unknown>): void {
    this.#ready = this.#tail = pending;
    const clear = () => {
      if (this.#tail === pending) this.#tail = undefined;
    };
    pending.then(clear, clear);
  }

  async stop(): Promise<void> {
    const errors: unknown[] = [];
    while (this.#cleanups.length) {
      const cleanup = this.#cleanups.pop()!;
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new AggregateError(errors, "cleanup failed");
    }
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.stop();
  }

  override use<U extends object>(middleware: ExtensionMiddleware<S & I & D, U>): Rhythm<S, I, D & U>;
  override use<X extends object>(middleware: MountMiddleware<X>): Rhythm<S, WidenInput<S & I & D, I, X>, D>;
  override use(middleware: Middleware<S & I & D>): this;
  override use(middleware: Middleware<any>): any {
    return super.use(middleware);
  }

  override callback(): RhythmHandler<I, S & I & D> {
    const fn = this.chain();
    const run = (input?: I) => {
      try {
        const ctx = Object.assign({}, this.#ctx, input) as S & I & D;
        return fn(ctx).then(() => ctx);
      } catch (error) {
        return Promise.reject(error);
      }
    };
    return ((input?: I) => (this.#ready ? this.#ready.then(() => run(input)) : run(input))) as RhythmHandler<
      I,
      S & I & D
    >;
  }
}
