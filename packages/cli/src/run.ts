import type { Rhythm } from "@rhythmjs/rhythm";
import { parseArgv } from "./argv";
import { createPrompt as createPromptWithIO, type RhythmPrompt, type RhythmPromptIO } from "./prompt";
import { RhythmCliResponse, type RhythmCliContext } from "./context";

export function toCliHandler<TContext extends RhythmCliContext>(
  app: Rhythm<RhythmCliContext, any, TContext>,
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

function defaultPromptIO(): RhythmPromptIO {
  const lines = console[Symbol.asyncIterator]();
  return {
    ask: async (query) => {
      process.stdout.write(query);
      const { value } = await lines.next();
      return value ?? "";
    },
    write: (text) => {
      process.stdout.write(text);
    },
    close: () => {
      void lines.return?.();
    },
  };
}

export function createPrompt(): { prompt: RhythmPrompt; close: () => void } {
  return createPromptWithIO(defaultPromptIO());
}
