import type { Rhythm } from "../../core/rhythm";
import { parseArgv } from "../argv";
import { RhythmCliResponse, type RhythmCliContext } from "./context";

export function toCliHandler<TContext extends RhythmCliContext, TProviders extends object = {}>(
  app: Rhythm<RhythmCliContext, TContext, TProviders>,
): (argv: string[]) => Promise<number> {
  const run = app.callback();
  return async (argv: string[]): Promise<number> => {
    const { flags } = parseArgv(argv);
    const stdin = process.stdin.isTTY ? null : (Bun.stdin.stream() as unknown as ReadableStream<Uint8Array>);

    const ctx = await run({ argv, flags, stdin, response: new RhythmCliResponse() });

    for (const line of ctx.response.stdout) console.log(line);
    for (const line of ctx.response.stderr) console.error(line);

    return ctx.response.exitCode;
  };
}
