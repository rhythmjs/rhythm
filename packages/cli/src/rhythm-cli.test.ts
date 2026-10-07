import { test, expect } from "bun:test";
import { parseArgs } from "node:util";
import { Pipeline, Rhythm, decorate, derive, mount } from "@rhythmjs/rhythm";
import { RhythmCli } from "./rhythm-cli";
import { createCliContext } from "./context";
import { toCliHandler } from "./run";

function harness() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: { write: (text: string) => out.push(text) },
      stderr: { write: (text: string) => err.push(text) },
    },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

async function run(app: { callback(): (ctx: any) => Promise<unknown> }, argv: string[]) {
  const h = harness();
  const code = await toCliHandler(app, h.io)(argv);
  return { code, stdout: h.stdout(), stderr: h.stderr() };
}

test("cmd runs its handler when the command matches", async () => {
  const calls: string[] = [];
  const cli = new RhythmCli().cmd("serve", () => void calls.push("serve"));

  const result = await run(cli, ["serve"]);

  expect(result.code).toBe(0);
  expect(calls).toEqual(["serve"]);
});

test("params are parsed from the command and typed", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli().cmd("copy :from :to", (ctx) => {
    const from: string = ctx.params.from;
    const to: string = ctx.params.to;
    seen.push(from, to);
  });

  await run(cli, ["copy", "a.txt", "b.txt"]);

  expect(seen).toEqual(["a.txt", "b.txt"]);
});

test("params are checked at compile time", () => {
  new RhythmCli().cmd("copy :from :to?", (ctx) => {
    // @ts-expect-error
    ctx.params.nope;
    // @ts-expect-error
    const to: string = ctx.params.to;
    return to;
  });
  // @ts-expect-error
  new RhythmCli().cmd("copy");
});

test("multi-word commands act as subcommands", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli()
    .cmd("db migrate :name", (ctx) => void seen.push(`migrate:${ctx.params.name}`))
    .cmd("db seed :count?", (ctx) => void seen.push(`seed:${ctx.params.count}`));

  await run(cli, ["db", "migrate", "init"]);
  await run(cli, ["db", "seed"]);
  await run(cli, ["db", "seed", "5"]);

  expect(seen).toEqual(["migrate:init", "seed:undefined", "seed:5"]);
});

test("the most specific command wins, whatever the registration order", async () => {
  const seen: string[] = [];
  const cli = new RhythmCli()
    .cmd("db :action", (ctx) => void seen.push(`action:${ctx.params.action}`))
    .cmd("db migrate", () => void seen.push("migrate"));

  await run(cli, ["db", "migrate"]);
  await run(cli, ["db", "seed"]);

  expect(seen).toEqual(["migrate", "action:seed"]);
});

test("an empty command is the root command", async () => {
  const seen: string[] = [];
  const cli = new RhythmCli().cmd("", () => void seen.push("root"));

  const result = await run(cli, []);

  expect(result.code).toBe(0);
  expect(seen).toEqual(["root"]);
});

test("**:name collects the remaining words as an array, at least one", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli().cmd("echo **:words", (ctx) => {
    const words: string[] = ctx.params.words;
    seen.push(words);
  });

  await run(cli, ["echo", "a", "b", "c"]);
  await run(cli, ["echo", "a"]);
  const none = await run(cli, ["echo"]);

  expect(seen).toEqual([["a", "b", "c"], ["a"]]);
  expect(none.code).toBe(2);
});

test(":name+ and :name* collect words too, one-or-more and zero-or-more", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli()
    .cmd("add :files+", (ctx) => void seen.push(["add", ctx.params.files]))
    .cmd("list :names*", (ctx) => void seen.push(["list", ctx.params.names]));

  await run(cli, ["add", "a", "b"]);
  const none = await run(cli, ["add"]);
  await run(cli, ["list"]);
  await run(cli, ["list", "x", "y", "z"]);

  expect(seen).toEqual([
    ["add", ["a", "b"]],
    ["list", []],
    ["list", ["x", "y", "z"]],
  ]);
  expect(none.code).toBe(2);
});

test("bare * and ** capture under key 0 as an array", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli()
    .cmd("rest *", (ctx) => void seen.push(["*", ctx.params[0]]))
    .cmd("any **", (ctx) => void seen.push(["**", ctx.params[0], "_" in ctx.params]));

  await run(cli, ["rest", "a", "b"]);
  await run(cli, ["any"]);
  await run(cli, ["any", "x"]);

  expect(seen).toEqual([
    ["*", ["a", "b"]],
    ["**", [], false],
    ["**", ["x"], false],
  ]);
});

test("named params and a catch-all can be combined", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli().cmd("copy :source **:targets", (ctx) => {
    const source: string = ctx.params.source;
    const targets: string[] = ctx.params.targets;
    seen.push(source, targets);
  });

  await run(cli, ["copy", "a.txt", "b.txt", "c.txt"]);

  expect(seen).toEqual(["a.txt", ["b.txt", "c.txt"]]);
});

test("words inside a catch-all keep their slashes, spaces and percent signs", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli().cmd("echo **:words", (ctx) => void seen.push(ctx.params.words));

  await run(cli, ["echo", "src/a.ts", "my notes", "100%"]);

  expect(seen).toEqual([["src/a.ts", "my notes", "100%"]]);
});

test("specificity: a literal beats a param, which beats a catch-all", async () => {
  const seen: string[] = [];
  const cli = new RhythmCli()
    .cmd("run **:args", () => void seen.push("catch-all"))
    .cmd("run :script", (ctx) => void seen.push(`script:${ctx.params.script}`))
    .cmd("run build", () => void seen.push("build"));

  await run(cli, ["run", "build"]);
  await run(cli, ["run", "lint"]);
  await run(cli, ["run", "a", "b"]);

  expect(seen).toEqual(["build", "script:lint", "catch-all"]);
});

test("rou3 regex constraints work on params", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli().cmd("kill :pid(\\d+)", (ctx) => void seen.push(ctx.params.pid));

  await run(cli, ["kill", "42"]);
  const letters = await run(cli, ["kill", "abc"]);

  expect(seen).toEqual(["42"]);
  expect(letters.code).toBe(2);
});

test("a command can have only one catch-all", () => {
  expect(() => new RhythmCli().cmd("x **:a :b+", () => {})).toThrow("only one");
});

test("catch-all params are typed as string arrays", () => {
  new RhythmCli().cmd("echo **:words", (ctx) => {
    // @ts-expect-error
    const word: string = ctx.params.words;
    return word;
  });
});

test("words with spaces, slashes and percent signs arrive intact", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli().cmd("open :target", (ctx) => {
    seen.push(ctx.params.target);
  });

  await run(cli, ["open", "my notes/todo 100%.txt"]);

  expect(seen).toEqual(["my notes/todo 100%.txt"]);
});

test("flags end routing and stay available on ctx.argv", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli()
    .cmd("serve :entry", (ctx) => void seen.push(`entry:${ctx.params.entry}`, ctx.argv))
    .cmd("serve", () => void seen.push("bare serve"));

  await run(cli, ["serve", "app.ts", "--port", "8080"]);
  await run(cli, ["serve", "--port", "8080", "app.ts"]);

  expect(seen).toEqual(["entry:app.ts", ["serve", "app.ts", "--port", "8080"], "bare serve"]);
});

test("command handlers form a middleware chain", async () => {
  const calls: string[] = [];
  const cli = new RhythmCli().cmd(
    "x",
    async (_ctx, next) => {
      calls.push("first in");
      await next();
      calls.push("first out");
    },
    (_ctx, next) => {
      calls.push("second");
      return next();
    },
    () => void calls.push("last"),
  );

  await run(cli, ["x"]);

  expect(calls).toEqual(["first in", "second", "last", "first out"]);
});

test("a command middleware can stop the chain with fail()", async () => {
  const calls: string[] = [];
  const cli = new RhythmCli().cmd(
    "deploy",
    (ctx) => ctx.fail("not logged in", 3),
    () => void calls.push("deployed"),
  );

  const result = await run(cli, ["deploy"]);

  expect(result.code).toBe(3);
  expect(result.stderr).toBe("error: not logged in\n");
  expect(calls).toEqual([]);
});

test("use middleware runs only when a command matches", async () => {
  const calls: string[] = [];
  const cli = new RhythmCli()
    .use(async (_ctx, next) => {
      calls.push("in");
      await next();
      calls.push("out");
    })
    .cmd("serve", () => void calls.push("serve"));

  await run(cli, ["serve"]);
  expect(calls).toEqual(["in", "serve", "out"]);

  calls.length = 0;
  for (const argv of [[], ["nope"], ["--help"], ["servee"]]) {
    await run(cli, argv);
  }
  expect(calls).toEqual([]);
});

test("use middleware wraps every command and can read the matched params", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli()
    .cmd("a :id", () => {})
    .use((ctx, next) => {
      seen.push(ctx.params);
      return next();
    })
    .cmd("b", () => {});

  await run(cli, ["a", "1"]);
  await run(cli, ["b"]);

  expect(seen).toEqual([{ id: "1" }, {}]);
});

test("a use middleware that skips next() blocks the command", async () => {
  const calls: string[] = [];
  const cli = new RhythmCli().use((ctx) => ctx.fail("blocked", 4)).cmd("serve", () => void calls.push("serve"));

  const result = await run(cli, ["serve"]);

  expect(result.code).toBe(4);
  expect(calls).toEqual([]);
});

test("use with derive widens the context for command handlers", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli().use(derive(() => ({ user: "ada" }))).cmd("whoami", (ctx) => {
    const user: string = ctx.user;
    seen.push(user);
  });

  await run(cli, ["whoami"]);

  expect(seen).toEqual(["ada"]);
});

test("an unmatched command is reported by the adapter with exit code 2", async () => {
  const calls: string[] = [];
  const cli = new RhythmCli().cmd("serve", () => void calls.push("serve"));

  const unknown = await run(cli, ["nope"]);
  const none = await run(cli, []);
  const flag = await run(cli, ["--help"]);

  expect(calls).toEqual([]);
  expect(unknown.code).toBe(2);
  expect(unknown.stderr).toBe("error: unknown command 'nope'\n");
  expect(none.code).toBe(2);
  expect(none.stderr).toBe("error: no command given\n");
  expect(flag.stderr).toBe("error: unknown command '--help'\n");
});

test("context helpers: log, error, fail and exitCode", async () => {
  const cli = new RhythmCli()
    .cmd("say", (ctx) => {
      ctx.log("hello", { a: 1 }, 42);
      ctx.error("careful");
    })
    .cmd("boom", (ctx) => ctx.fail("it broke"))
    .cmd("code", (ctx) => {
      ctx.exitCode = 7;
    });

  const say = await run(cli, ["say"]);
  const boom = await run(cli, ["boom"]);
  const code = await run(cli, ["code"]);

  expect(say.stdout).toBe("hello { a: 1 } 42\n");
  expect(say.stderr).toBe("careful\n");
  expect(say.code).toBe(0);
  expect(boom.code).toBe(1);
  expect(boom.stderr).toBe("error: it broke\n");
  expect(code.code).toBe(7);
});

test("a thrown error becomes an error line and exit code 1", async () => {
  const cli = new RhythmCli().cmd("boom", () => {
    throw new Error("kaboom");
  });

  const result = await run(cli, ["boom"]);

  expect(result.code).toBe(1);
  expect(result.stderr).toBe("error: kaboom\n");
});

test("an error-boundary middleware can handle failures itself", async () => {
  const cli = new RhythmCli()
    .use(async (ctx, next) => {
      try {
        await next();
      } catch (error) {
        ctx.fail(`handled: ${(error as Error).message}`, 9);
      }
    })
    .cmd("boom", () => {
      throw new Error("kaboom");
    });

  const result = await run(cli, ["boom"]);

  expect(result.code).toBe(9);
  expect(result.stderr).toBe("error: handled: kaboom\n");
});

test("async handlers are awaited before the exit code is read", async () => {
  const cli = new RhythmCli().cmd("slow", async (ctx) => {
    await Bun.sleep(10);
    ctx.exitCode = 4;
  });

  expect((await run(cli, ["slow"])).code).toBe(4);
});

test("option parsing lives in a middleware, not in the cli", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli()
    .use(
      derive((ctx) => ({
        options: parseArgs({
          args: ctx.argv,
          options: { port: { type: "string", short: "p", default: "3000" } },
          allowPositionals: true,
        }).values,
      })),
    )
    .cmd("serve :entry", (ctx) => void seen.push(ctx.params.entry, ctx.options.port));

  await run(cli, ["serve", "app.ts"]);
  await run(cli, ["serve", "app.ts", "-p", "8080"]);

  expect(seen).toEqual(["app.ts", "3000", "app.ts", "8080"]);
});

test("help lives in a middleware too", async () => {
  const calls: string[] = [];
  const cli = new RhythmCli()
    .use((ctx, next) => {
      if (ctx.argv.includes("--help")) {
        ctx.log(`usage: rhythm ${ctx.argv[0]}`);
        return;
      }
      return next();
    })
    .cmd("serve", () => void calls.push("serve"));

  const help = await run(cli, ["serve", "--help"]);
  const plain = await run(cli, ["serve"]);

  expect(help.stdout).toBe("usage: rhythm serve\n");
  expect(calls).toEqual(["serve"]);
  expect(plain.code).toBe(0);
});

test("a cli can be mounted inside a Rhythm app", async () => {
  const cli = new RhythmCli().cmd("ping", (ctx) => {
    ctx.log("pong");
    ctx.fail("nope", 5);
  });
  const app = new Rhythm().register(decorate(() => ({ appName: "wrapped" }))).use(mount(cli));

  const ok = await run(app, ["ping"]);
  const unknown = await run(app, ["nope"]);

  expect(ok.stdout).toBe("pong\n");
  expect(ok.code).toBe(5);
  expect(unknown.code).toBe(2);
  expect(unknown.stderr).toBe("error: unknown command 'nope'\n");
});

test("derive as the first command handler widens the ctx type for the handlers after it", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli().cmd(
    "whoami",
    derive(() => ({ user: "ada", visits: 3 })),
    (ctx) => {
      const user: string = ctx.user;
      const visits: number = ctx.visits;
      seen.push(user, visits);
    },
  );

  await run(cli, ["whoami"]);

  expect(seen).toEqual(["ada", 3]);
});

test("derived command values are precisely typed, not any", () => {
  new RhythmCli().cmd(
    "whoami",
    derive(() => ({ user: "ada" })),
    (ctx) => {
      // @ts-expect-error
      const wrong: number = ctx.user;
      return wrong;
    },
  );
});

test("a command derive can read params", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli().cmd(
    "deploy :env",
    derive((ctx) => ({ url: `https://${ctx.params.env}.example.com` })),
    (ctx) => {
      const url: string = ctx.url;
      seen.push(url);
    },
  );

  await run(cli, ["deploy", "staging"]);

  expect(seen).toEqual(["https://staging.example.com"]);
});

test("an async command derive is awaited and typed by its resolved value", async () => {
  const seen: unknown[] = [];
  const cli = new RhythmCli().cmd(
    "x",
    derive(async () => ({ token: await Promise.resolve("abc") })),
    (ctx) => {
      const token: string = ctx.token;
      seen.push(token);
    },
  );

  await run(cli, ["x"]);

  expect(seen).toEqual(["abc"]);
});

test("command derive works with further middleware, and only for its own command", async () => {
  const calls: string[] = [];
  const cli = new RhythmCli()
    .cmd(
      "a",
      derive(() => ({ n: 1 })),
      (_ctx, next) => {
        calls.push("mw");
        return next();
      },
      (ctx) => void calls.push(`a:${ctx.n}`),
    )
    // @ts-expect-error `n` is only derived for command a
    .cmd("b", (ctx) => void calls.push(`b:${ctx.n}`));

  await run(cli, ["a"]);
  await run(cli, ["b"]);

  expect(calls).toEqual(["mw", "a:1", "b:undefined"]);
});

test("RhythmCli is a Pipeline", () => {
  expect(new RhythmCli()).toBeInstanceOf(Pipeline);
});

test("createCliContext writes through the injected streams", () => {
  const h = harness();
  const ctx = createCliContext(["a"], h.io);

  ctx.log("out");
  ctx.error("err");

  expect(ctx.argv).toEqual(["a"]);
  expect(h.stdout()).toBe("out\n");
  expect(h.stderr()).toBe("err\n");
});
