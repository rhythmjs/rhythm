import { expect, test } from "bun:test";
import { Rhythm, decorate, derive, mount } from "@rhythmjs/rhythm";
import { withParsedArgv } from "./argv";
import type { RhythmCliContext } from "./context";
import { withPrompt, type RhythmPrompt } from "./prompt";
import { RhythmCli } from "./rhythm-cli";
import { toCliHandler } from "./run";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_T extends true>() => {};

test("command params are typed from the command string", () => {
  new RhythmCli()
    .cmd("greet :name", (ctx) => {
      assertType<Equal<typeof ctx.params.name, string>>();
      // @ts-expect-error not in the command
      ctx.params.nope;
    })
    .cmd("opt :name?", (ctx) => {
      assertType<Equal<typeof ctx.params.name, string | undefined>>();
    })
    .cmd("sum :numbers+", (ctx) => {
      assertType<Equal<typeof ctx.params.numbers, string[]>>();
    })
    .cmd("echo **:words", (ctx) => {
      assertType<Equal<typeof ctx.params.words, string[]>>();
    })
    .cmd("db migrate :name", (ctx) => {
      assertType<Equal<typeof ctx.params.name, string>>();
    })
    .cmd("plain", (ctx) => {
      // @ts-expect-error no params
      ctx.params.id;
    });
  expect(true).toBe(true);
});

test("the cli context is typed and unknown fields are errors", () => {
  new RhythmCli().cmd("x", (ctx) => {
    assertType<Equal<typeof ctx.argv, string[]>>();
    ctx.log("a", 1);
    ctx.error("e");
    ctx.fail("bad", 2);
    // @ts-expect-error code must be a number
    ctx.fail("bad", "2");
    // @ts-expect-error not on the context
    ctx.nope;
    // @ts-expect-error argv is readonly
    ctx.argv = [];
    ctx.exitCode = 3;
    // @ts-expect-error exitCode is a number
    ctx.exitCode = "3";
  });
  expect(true).toBe(true);
});

test("a command needs at least one handler", () => {
  const neverRuns = () => {
    // @ts-expect-error
    new RhythmCli().cmd("x");
  };
  void neverRuns;
  expect(true).toBe(true);
});

test("cli-level derive widens the context for commands registered after, with its type", () => {
  new RhythmCli()
    .cmd("before", (ctx) => {
      // @ts-expect-error not derived yet
      ctx.startedAt;
    })
    .use(derive(() => ({ startedAt: 1 })))
    .cmd("after :id", (ctx) => {
      assertType<Equal<typeof ctx.startedAt, number>>();
      assertType<Equal<typeof ctx.params.id, string>>();
    });
  expect(true).toBe(true);
});

test("a command-level derive only widens that command's later handlers", () => {
  new RhythmCli()
    .cmd(
      "a",
      derive(() => ({ n: 1 })),
      (ctx) => {
        assertType<Equal<typeof ctx.n, number>>();
      },
    )
    .cmd("b", (ctx) => {
      // @ts-expect-error
      ctx.n;
    });
  expect(true).toBe(true);
});

test("withParsedArgv adds typed flags and positionals", () => {
  new RhythmCli().use(withParsedArgv()).cmd("x", (ctx) => {
    assertType<Equal<typeof ctx.flags, Record<string, string | boolean>>>();
    assertType<Equal<typeof ctx.positionals, string[]>>();
  });
  new RhythmCli().cmd("x", (ctx) => {
    // @ts-expect-error not added without withParsedArgv
    ctx.flags;
  });
  expect(true).toBe(true);
});

test("withPrompt adds a typed prompt", () => {
  new RhythmCli().use(withPrompt()).cmd("x", async (ctx) => {
    assertType<Equal<typeof ctx.prompt, RhythmPrompt>>();
    const name = await ctx.prompt.text("?", { default: "a" });
    assertType<Equal<typeof name, string>>();
    const ok = await ctx.prompt.confirm("?");
    assertType<Equal<typeof ok, boolean>>();
    // @ts-expect-error message must be a string
    await ctx.prompt.text(1);
  });
  new RhythmCli().cmd("x", (ctx) => {
    // @ts-expect-error not added without withPrompt
    ctx.prompt;
  });
  expect(true).toBe(true);
});

test("mount requires the parent to supply what the cli needs", () => {
  const needsConfig = new RhythmCli<{ config: string }>();
  new Rhythm().register(decorate(() => ({ config: "x" }))).use(mount(needsConfig));
  // @ts-expect-error parent has no config
  new Rhythm().use(mount(needsConfig));
  const own = new RhythmCli().use(derive(() => ({ own: 1 })));
  new Rhythm().use(mount(own));
  expect(true).toBe(true);
});

test("commands see what the cli declares it needs", () => {
  new RhythmCli<{ config: string }>().cmd("x", (ctx) => {
    assertType<Equal<typeof ctx.config, string>>();
  });
  expect(true).toBe(true);
});

test("toCliHandler accepts clis and apps, and rejects apps needing other input", () => {
  toCliHandler(new RhythmCli());
  toCliHandler(new Rhythm());
  toCliHandler(new Rhythm<{}, RhythmCliContext>());
  // @ts-expect-error needs input the cli runner cannot supply
  toCliHandler(new Rhythm<{}, { userId: string }>());
  expect(true).toBe(true);
});
