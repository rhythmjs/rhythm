import { RhythmMutable } from "@rhythmjs/rhythm/types";

export class RhythmCliResponse {
  readonly [RhythmMutable] = true;

  exitCode = 0;
  stdout: string[] = [];
  stderr: string[] = [];

  print(line: string): this {
    this.stdout.push(line);
    return this;
  }

  printError(line: string): this {
    this.stderr.push(line);
    return this;
  }

  exit(code: number): this {
    this.exitCode = code;
    return this;
  }
}

export interface RhythmCliContext {
  argv: string[];
  flags: Record<string, string | boolean>;
  stdin: ReadableStream<Uint8Array> | null;
  response: RhythmCliResponse;
}
