import { describe, expect, test } from "bun:test";
import { RhythmCli } from "./rhythm-cli";
import { parseArgv, withParsedArgv } from "./argv";
import { toCliHandler } from "./run";

describe("parseArgv()", () => {
  test("separates positionals from flags", () => {
    const { positionals, flags } = parseArgv(["deploy", "production"]);
    expect(positionals).toEqual(["deploy", "production"]);
    expect(flags).toEqual({});
  });

  test("parses --flag value as a string flag", () => {
    const { flags } = parseArgv(["--env", "staging"]);
    expect(flags).toEqual({ env: "staging" });
  });

  test("parses --flag=value", () => {
    const { flags } = parseArgv(["--env=staging"]);
    expect(flags).toEqual({ env: "staging" });
  });

  test("parses a trailing --flag with no value as boolean true", () => {
    const { flags } = parseArgv(["--verbose"]);
    expect(flags).toEqual({ verbose: true });
  });

  test("parses --flag as boolean true when the next token is itself a flag", () => {
    const { flags } = parseArgv(["--verbose", "--force"]);
    expect(flags).toEqual({ verbose: true, force: true });
  });

  test("parses short flags the same way", () => {
    const { flags } = parseArgv(["-f", "value", "-v"]);
    expect(flags).toEqual({ f: "value", v: true });
  });

  test("treats everything after -- as positional, unparsed", () => {
    const { positionals, flags } = parseArgv(["run", "--", "--not-a-flag", "-x"]);
    expect(positionals).toEqual(["run", "--not-a-flag", "-x"]);
    expect(flags).toEqual({});
  });

  test("mixes positionals and flags in any order", () => {
    const { positionals, flags } = parseArgv(["deploy", "--env=production", "--force", "now"]);
    expect(positionals).toEqual(["deploy"]);
    expect(flags).toEqual({ env: "production", force: "now" });
  });

  test("without a flag schema, a value-taking flag greedily consumes the next positional-looking token (same default as minimist)", () => {
    const { positionals, flags } = parseArgv(["deploy", "--force", "now"]);
    expect(positionals).toEqual(["deploy"]);
    expect(flags).toEqual({ force: "now" });
  });
});

function capture() {
  const out: string[] = [];
  return { out, io: { stdout: { write: (t: string) => out.push(t) }, stderr: { write: () => {} } } };
}

test("withParsedArgv() adds flags and positionals to the context", async () => {
  const { out, io } = capture();
  const cli = new RhythmCli()
    .use(withParsedArgv())
    .cmd("greet :name", (ctx) => ctx.log(ctx.params.name, ctx.flags.loud, ctx.positionals));
  expect(await toCliHandler(cli, io)(["greet", "ada", "--loud"])).toBe(0);
  expect(out.join("")).toBe("ada true [ 'greet', 'ada' ]\n");
});
