import { expect, test } from "bun:test";
import { toCliHandler } from "@rhythmjs/cli/run";
import { app } from "./app";

function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io = { stdout: { write: (t: string) => out.push(t) }, stderr: { write: (t: string) => err.push(t) } };
  return toCliHandler(app, io)(argv).then((code) => ({ code, out: out.join(""), err: err.join("") }));
}

test("no command, help and --help print usage", async () => {
  for (const argv of [[], ["help"], ["--help"], ["new", "--help"]]) {
    const { code, out } = await run(argv);
    expect(code).toBe(0);
    expect(out).toContain("Usage: rhythm <command>");
  }
});

test("an unknown command fails with exit code 2", async () => {
  const { code, err } = await run(["bogus"]);
  expect(code).toBe(2);
  expect(err).toContain("unknown command 'bogus'");
});
