export type CliWriter = { write(text: string): unknown };

export type CliIO = { stdout: CliWriter; stderr: CliWriter };

export interface RhythmCliContext {
  readonly argv: string[];
  readonly stdout: CliWriter;
  readonly stderr: CliWriter;
  exitCode: number;
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
  };
}
