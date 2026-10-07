import { describe, expect, test } from "bun:test";
import { RhythmCli } from "./rhythm-cli";
import { createPrompt, withPrompt, type RhythmPromptIO } from "./prompt";
import { toCliHandler } from "./run";

function fakeIO(answers: string[]): { io: RhythmPromptIO; output: () => string } {
  const queue = [...answers];
  const written: string[] = [];
  const io: RhythmPromptIO = {
    ask: async (query) => {
      written.push(query);
      return queue.shift() ?? "";
    },
    write: (text) => {
      written.push(text);
    },
  };
  return { io, output: () => written.join("") };
}

describe("createPrompt()", () => {
  describe("text()", () => {
    test("returns the entered line", async () => {
      const { io } = fakeIO(["Alice"]);
      const { prompt } = createPrompt(io);

      expect(await prompt.text("What's your name?")).toBe("Alice");
    });

    test("falls back to the default when the answer is empty", async () => {
      const { io } = fakeIO([""]);
      const { prompt } = createPrompt(io);

      expect(await prompt.text("Project name?", { default: "my-app" })).toBe("my-app");
    });
  });

  describe("confirm()", () => {
    test("accepts y/yes as true and n/no as false", async () => {
      const { io } = fakeIO(["y", "yes", "n", "no"]);
      const { prompt } = createPrompt(io);

      expect(await prompt.confirm("A?")).toBe(true);
      expect(await prompt.confirm("B?")).toBe(true);
      expect(await prompt.confirm("C?")).toBe(false);
      expect(await prompt.confirm("D?")).toBe(false);
    });

    test("uses the default when the answer is empty", async () => {
      const { io } = fakeIO([""]);
      const { prompt } = createPrompt(io);

      expect(await prompt.confirm("Proceed?", { default: true })).toBe(true);
    });

    test("re-prompts on an unrecognized answer", async () => {
      const { io, output } = fakeIO(["maybe", "y"]);
      const { prompt } = createPrompt(io);

      expect(await prompt.confirm("Sure?")).toBe(true);
      expect(output()).toContain("Please answer y or n.");
    });
  });

  describe("select()", () => {
    test("returns the choice at the entered index", async () => {
      const { io } = fakeIO(["2"]);
      const { prompt } = createPrompt(io);

      const choice = await prompt.select("Pick one", ["staging", "production"] as const);
      expect(choice).toBe("production");
    });

    test("re-prompts on an out-of-range index", async () => {
      const { io, output } = fakeIO(["9", "1"]);
      const { prompt } = createPrompt(io);

      expect(await prompt.select("Pick one", ["a", "b"] as const)).toBe("a");
      expect(output()).toContain("Invalid choice, try again.");
    });

    test("allowCustom lets the user type a value not in the list, as the last option", async () => {
      const { io, output } = fakeIO(["3", "eu-west-2"]);
      const { prompt } = createPrompt(io);

      const choice = await prompt.select("Region", ["us-east", "eu-central"] as const, { allowCustom: true });
      expect(choice).toBe("eu-west-2");
      expect(output()).toContain("3) Other (type your own)");
    });
  });

  describe("multiSelect()", () => {
    test("returns the choices at the entered indices", async () => {
      const { io } = fakeIO(["1,3"]);
      const { prompt } = createPrompt(io);

      const choices = await prompt.multiSelect("Pick some", ["a", "b", "c"] as const);
      expect(choices).toEqual(["a", "c"]);
    });

    test("re-prompts when any entered index is invalid", async () => {
      const { io, output } = fakeIO(["1,9", "2"]);
      const { prompt } = createPrompt(io);

      expect(await prompt.multiSelect("Pick some", ["a", "b"] as const)).toEqual(["b"]);
      expect(output()).toContain("Invalid choices, try again.");
    });

    test("allowCustom lets one of the selected entries be a typed-in value", async () => {
      const { io } = fakeIO(["1,3", "custom-tag"]);
      const { prompt } = createPrompt(io);

      const choices = await prompt.multiSelect("Tags", ["frontend", "backend"] as const, { allowCustom: true });
      expect(choices).toEqual(["frontend", "custom-tag"]);
    });
  });
});

function capture() {
  const out: string[] = [];
  return { out, io: { stdout: { write: (t: string) => out.push(t) }, stderr: { write: () => {} } } };
}

test("withPrompt() provides a prompt and closes its IO afterwards", async () => {
  const { out, io } = capture();
  let closed = false;
  const cli = new RhythmCli()
    .use(
      withPrompt(() => ({
        ask: async () => "ada",
        write: () => {},
        close: () => void (closed = true),
      })),
    )
    .cmd("hi", async (ctx) => ctx.log(await ctx.prompt.text("name?")));
  expect(await toCliHandler(cli, io)(["hi"])).toBe(0);
  expect(out.join("")).toBe("ada\n");
  expect(closed).toBe(true);
});
