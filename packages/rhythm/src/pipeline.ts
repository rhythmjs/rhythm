import { compose } from "./compose";
import { sourceOf } from "./source";
import type { Middleware, Next, PipelineOptions } from "./types";

export abstract class Pipeline<C> {
  #middleware: Middleware<C>[] = [];
  #sources: object[] = [];

  readonly options: PipelineOptions;
  parent?: Pipeline<any>;

  protected readonly transparent: boolean = false;

  constructor(options: PipelineOptions = {}) {
    this.options = options;
  }

  get sources(): readonly object[] {
    return this.#sources.flatMap((source) =>
      source instanceof Pipeline && source.transparent ? source.sources : [source],
    );
  }

  use(middleware: Middleware<C>): this {
    this.#middleware.push(middleware);
    this.adopt(sourceOf(middleware));
    return this;
  }

  abstract callback(): (...input: any[]) => Promise<unknown>;

  protected adopt(source: object | undefined): void {
    if (!source) return;
    if (source instanceof Pipeline) source.parent = this;
    this.#sources.push(source);
  }

  protected chain(): (ctx: C, next?: Next) => Promise<void> {
    return compose([...this.#middleware]);
  }
}
