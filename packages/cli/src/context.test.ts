import { describe, expect, test } from "bun:test";
import { RhythmCliResponse, type RhythmCliContext } from "./context";

describe("RhythmCliResponse", () => {
  test.skip("type system: the input side of the context is readonly", () => {
    const ctx = { response: new RhythmCliResponse() } as RhythmCliContext;
    // @ts-expect-error the argv binding is readonly
    ctx.argv = [];
    // @ts-expect-error the argv array itself is readonly
    ctx.argv.push("extra");
    // @ts-expect-error flags entries are readonly
    ctx.flags.verbose = true;
    // @ts-expect-error the response binding is readonly (its fields stay mutable)
    ctx.response = new RhythmCliResponse();
    ctx.response.exitCode = 1;
  });

  test("defaults to exit code 0, no stdout/stderr", () => {
    const response = new RhythmCliResponse();
    expect(response.exitCode).toBe(0);
    expect(response.stdout).toEqual([]);
    expect(response.stderr).toEqual([]);
  });

  test("print() appends to stdout and returns this for chaining", () => {
    const response = new RhythmCliResponse();
    const result = response.print("line one").print("line two");

    expect(result).toBe(response);
    expect(response.stdout).toEqual(["line one", "line two"]);
  });

  test("printError() appends to stderr, independent of stdout", () => {
    const response = new RhythmCliResponse();
    response.print("normal").printError("oops");

    expect(response.stdout).toEqual(["normal"]);
    expect(response.stderr).toEqual(["oops"]);
  });

  test("exit() sets the exit code and returns this for chaining", () => {
    const response = new RhythmCliResponse();
    const result = response.exit(1);

    expect(result).toBe(response);
    expect(response.exitCode).toBe(1);
  });

  test("methods chain together in one expression", () => {
    const response = new RhythmCliResponse().print("hello").printError("warn").exit(2);

    expect(response.stdout).toEqual(["hello"]);
    expect(response.stderr).toEqual(["warn"]);
    expect(response.exitCode).toBe(2);
  });
});
