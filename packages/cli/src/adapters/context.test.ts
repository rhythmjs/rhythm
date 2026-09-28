import { describe, expect, test } from "vite-plus/test";
import { RhythmMutable } from "@rhythmjs/rhythm";
import { RhythmCliResponse } from "./context";

describe("RhythmCliResponse", () => {
  test("defaults to exit code 0, no stdout/stderr", () => {
    const response = new RhythmCliResponse();
    expect(response.exitCode).toBe(0);
    expect(response.stdout).toEqual([]);
    expect(response.stderr).toEqual([]);
  });

  test("carries the RhythmMutable brand so it opts out of DeepReadonly", () => {
    const response = new RhythmCliResponse();
    expect(response[RhythmMutable]).toBe(true);
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
