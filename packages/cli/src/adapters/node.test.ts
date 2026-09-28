import { describe, expect, test, vi } from "vite-plus/test";
import { Rhythm } from "@rhythmjs/rhythm";
import type { RhythmCliContext } from "./context";
import { createPrompt, toCliHandler } from "./node";

function withStdinTTY<T>(isTTY: boolean, fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
  try {
    return fn();
  } finally {
    if (original) Object.defineProperty(process.stdin, "isTTY", original);
  }
}

describe("toCliHandler()", () => {
  test("seeds argv and parsed flags onto context, and returns the response's exit code", async () => {
    let seenArgv: string[] = [];
    let seenFlags: Record<string, string | boolean> = {};

    const app = new Rhythm<RhythmCliContext>().use((ctx) => {
      seenArgv = [...ctx.argv];
      seenFlags = { ...ctx.flags };
      ctx.response.exit(7);
    });

    const code = await toCliHandler(app)(["deploy", "--env=production", "--force"]);

    expect(code).toBe(7);
    expect(seenArgv).toEqual(["deploy", "--env=production", "--force"]);
    expect(seenFlags).toEqual({ env: "production", force: true });
  });

  test("defaults to exit code 0 when nothing sets one", async () => {
    const app = new Rhythm<RhythmCliContext>().use(() => {});
    const code = await toCliHandler(app)([]);
    expect(code).toBe(0);
  });

  test("flushes response.stdout/stderr to the console", async () => {
    const app = new Rhythm<RhythmCliContext>().use((ctx) => {
      ctx.response.print("hello").printError("warn");
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await toCliHandler(app)([]);
      expect(logSpy).toHaveBeenCalledWith("hello");
      expect(errorSpy).toHaveBeenCalledWith("warn");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test("ctx.stdin is null when stdin is a TTY", async () => {
    let seenStdin: unknown;
    const app = new Rhythm<RhythmCliContext>().use((ctx) => {
      seenStdin = ctx.stdin;
    });

    await withStdinTTY(true, () => toCliHandler(app)([]));
    expect(seenStdin).toBeNull();
  });

  test("ctx.stdin is a readable stream when stdin is not a TTY (piped/redirected)", async () => {
    let seenStdin: unknown;
    const app = new Rhythm<RhythmCliContext>().use((ctx) => {
      seenStdin = ctx.stdin;
    });

    await withStdinTTY(false, () => toCliHandler(app)([]));
    expect(seenStdin).not.toBeNull();
    expect(seenStdin).toBeInstanceOf(ReadableStream);
  });
});

describe("createPrompt()", () => {
  test("wires a readline-backed RhythmPromptIO and returns the full prompt surface", () => {
    const { prompt, close } = createPrompt();

    expect(typeof prompt.text).toBe("function");
    expect(typeof prompt.confirm).toBe("function");
    expect(typeof prompt.select).toBe("function");
    expect(typeof prompt.multiSelect).toBe("function");

    close();
  });
});
