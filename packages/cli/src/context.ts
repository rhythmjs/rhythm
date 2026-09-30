export class RhythmCliResponse {
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
  readonly argv: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly stdin: ReadableStream<Uint8Array> | null;
  readonly response: RhythmCliResponse;
}
