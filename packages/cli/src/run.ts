import type { Mountable } from "@rhythmjs/rhythm";
import { createCliContext, type CliIO, type RhythmCliContext } from "./context";

export function toCliHandler<I extends object = any>(
  app: Mountable<I> & (RhythmCliContext extends I ? unknown : never),
  io?: CliIO,
): (argv: string[]) => Promise<number> {
  const run = app.callback();
  return async (argv) => {
    const base = createCliContext(argv, io);
    try {
      const result = (await run(base)) as (Partial<RhythmCliContext> & { params?: unknown }) | undefined;
      if (result?.params === undefined) {
        base.fail(argv.length ? `unknown command '${argv[0]}'` : "no command given", 2);
        return base.exitCode;
      }
      return result.exitCode ?? base.exitCode;
    } catch (error) {
      base.fail(error instanceof Error ? error.message : String(error));
      return base.exitCode;
    }
  };
}
