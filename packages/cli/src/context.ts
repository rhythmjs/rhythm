import { format } from "node:util";

export type CliWriter = { write(text: string): unknown };

export type CliIO = { stdout: CliWriter; stderr: CliWriter };

export interface RhythmCliContext {
  readonly argv: string[];
  readonly stdout: CliWriter;
  readonly stderr: CliWriter;
  exitCode: number;
  log(...parts: unknown[]): void;
  error(...parts: unknown[]): void;
  fail(this: RhythmCliContext, message: string, code?: number): void;
}

export function createCliContext(
  argv: string[],
  io: CliIO = { stdout: process.stdout, stderr: process.stderr },
): RhythmCliContext {
  return {
    argv,
    stdout: io.stdout,
    stderr: io.stderr,
    exitCode: 0,
    log(...parts: unknown[]): void {
      io.stdout.write(`${format(...parts)}\n`);
    },
    error(...parts: unknown[]): void {
      io.stderr.write(`${format(...parts)}\n`);
    },
    fail(this: RhythmCliContext, message: string, code: number = 1): void {
      io.stderr.write(`error: ${message}\n`);
      this.exitCode = code;
    },
  };
}
