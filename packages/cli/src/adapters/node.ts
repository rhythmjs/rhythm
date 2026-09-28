import * as readline from "node:readline";
import { Readable } from "node:stream";
import type { Rhythm } from "@rhythmjs/rhythm";
import { parseArgv } from "../argv";
import { createPrompt as createPromptWithIO, type RhythmPrompt, type RhythmPromptIO } from "../prompt";
import { RhythmCliResponse, type RhythmCliContext } from "./context";

export function toCliHandler<TContext extends RhythmCliContext, TProviders extends object = {}>(
  app: Rhythm<RhythmCliContext, TContext, TProviders>,
): (argv: string[]) => Promise<number> {
  const run = app.callback();
  return async (argv: string[]): Promise<number> => {
    const { flags } = parseArgv(argv);
    const stdin = process.stdin.isTTY ? null : (Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>);

    const ctx = await run({ argv, flags, stdin, response: new RhythmCliResponse() });

    for (const line of ctx.response.stdout) console.log(line);
    for (const line of ctx.response.stderr) console.error(line);

    return ctx.response.exitCode;
  };
}

function defaultPromptIO(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): RhythmPromptIO {
  const rl = readline.createInterface({ input, output });
  return {
    ask: (query) => new Promise((resolve) => rl.question(query, resolve)),
    write: (text) => {
      output.write(text);
    },
    close: () => rl.close(),
  };
}

export function createPrompt(): { prompt: RhythmPrompt; close: () => void } {
  return createPromptWithIO(defaultPromptIO());
}
