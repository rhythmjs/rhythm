import { format } from "node:util";
import type { CliWriter } from "./context";

export type HasStdout = { readonly stdout: CliWriter };
export type HasStderr = { readonly stderr: CliWriter };
export type CanFail = HasStderr & { exitCode: number };

export function log(ctx: HasStdout, ...parts: unknown[]): void {
  ctx.stdout.write(`${format(...parts)}\n`);
}

export function error(ctx: HasStderr, ...parts: unknown[]): void {
  ctx.stderr.write(`${format(...parts)}\n`);
}

export function fail(ctx: CanFail, message: string, code: number = 1): void {
  ctx.stderr.write(`error: ${message}\n`);
  ctx.exitCode = code;
}
