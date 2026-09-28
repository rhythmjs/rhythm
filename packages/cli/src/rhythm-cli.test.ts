import { describe, expect, test, vi } from "vite-plus/test";
import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmCliResponse, type RhythmCliContext } from "./adapters/context";
import { toCliHandler } from "./adapters/bun";
import { RhythmCli } from "./rhythm-cli";

vi.stubGlobal("Bun", { stdin: { stream: () => new ReadableStream<Uint8Array>() } });

const host = (cli: RhythmCli<any>) => new Rhythm<RhythmCliContext>().use(cli.commands());

function collect(app: Rhythm<RhythmCliContext, any, any>) {
  return async (argv: string[]) => {
    const ctx = await app.run({ argv, flags: {}, stdin: null, response: new RhythmCliResponse() });
    return {
      stdout: ctx.response.stdout.join("\n"),
      stderr: ctx.response.stderr.join("\n"),
      exitCode: ctx.response.exitCode,
    };
  };
}

describe("RhythmCli", () => {
  test("matches a command path and extracts named args", async () => {
    const cli = new RhythmCli().command("deploy :environment", (ctx) => {
      ctx.response.print(`deploying to ${ctx.args.environment}`);
    });
    const run = collect(host(cli));

    const result = await run(["deploy", "production"]);
    expect(result.stdout).toBe("deploying to production");
    expect(result.exitCode).toBe(0);
  });

  test("falls through when the command path doesn't match - no output, default exit code", async () => {
    const cli = new RhythmCli().command("deploy :environment", (ctx) => {
      ctx.response.print("deployed");
    });
    const run = collect(host(cli));

    const result = await run(["build"]);
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("multiple handlers per command compose in onion order", async () => {
    const events: string[] = [];
    const cli = new RhythmCli().command(
      "deploy :environment",
      async (ctx, next) => {
        events.push("auth:before");
        await next();
        events.push("auth:after");
      },
      (ctx) => {
        events.push(`handler:${ctx.args.environment}`);
      },
    );

    await toCliHandler(host(cli))(["deploy", "staging"]);
    expect(events).toEqual(["auth:before", "handler:staging", "auth:after"]);
  });

  test("registration order is execution order - use() after a command doesn't wrap that command", async () => {
    const events: string[] = [];
    const cli = new RhythmCli()
      .command("greet", (ctx) => {
        events.push("command");
        ctx.response.print("hello");
      })
      .use(async (ctx, next) => {
        events.push("late-middleware");
        await next();
      });

    await collect(host(cli))(["greet"]);
    expect(events).toEqual(["command"]);
  });

  test("a middleware between two commands wraps only the command registered after it", async () => {
    const events: string[] = [];
    const cli = new RhythmCli()
      .command("early", () => {
        events.push("early");
      })
      .use(async (ctx, next) => {
        events.push("middleware");
        await next();
      })
      .command("late", () => {
        events.push("late");
      });
    const run = collect(host(cli));

    await run(["early"]);
    await run(["late"]);
    expect(events).toEqual(["early", "middleware", "late"]);
  });

  test("a cli is a controller, not a module - it exposes no register() or provide()", () => {
    const cli = new RhythmCli();

    expect("register" in cli).toBe(false);
    expect("provide" in cli).toBe(false);
  });

  describe("prefix", () => {
    test("commands are matched under the configured prefix, and not without it", async () => {
      const cli = new RhythmCli({ prefix: "remote" }).command("add :name", (ctx) => {
        ctx.response.print(ctx.args.name);
      });
      const run = collect(host(cli));

      expect((await run(["remote", "add", "origin"])).stdout).toBe("origin");
      expect((await run(["add", "origin"])).stdout).toBe("");
    });

    test("a parent cli's prefix applies to a child cli mounted via use(child)", async () => {
      const remoteCli = new RhythmCli().command("add :name", (ctx) => {
        ctx.response.print(ctx.args.name);
      });
      const gitCli = new RhythmCli({ prefix: "remote" }).use(remoteCli);
      const run = collect(host(gitCli));

      expect((await run(["remote", "add", "origin"])).stdout).toBe("origin");
      expect((await run(["add", "origin"])).stdout).toBe("");
    });

    test("prefixes compose across multiple levels of nesting", async () => {
      const remoteCli = new RhythmCli().command("add :name", (ctx) => {
        ctx.response.print(ctx.args.name);
      });
      const gitCli = new RhythmCli({ prefix: "git" }).use(remoteCli);
      const rootCli = new RhythmCli({ prefix: "vcs" }).use(gitCli);
      const run = collect(host(rootCli));

      expect((await run(["vcs", "git", "add", "origin"])).stdout).toBe("origin");
    });
  });

  describe("commands(), mounted via a parent's use() (koa-style)", () => {
    test("a matched command short-circuits the parent app's downstream middleware", async () => {
      const cli = new RhythmCli().command("greet", (ctx) => {
        ctx.response.print("hello");
      });

      const app = new Rhythm<RhythmCliContext>().use(cli.commands()).use((ctx) => {
        ctx.response.exit(1).print("fallback");
      });
      const run = collect(app);

      const result = await run(["greet"]);
      expect(result.stdout).toBe("hello");
      expect(result.exitCode).toBe(0);
    });

    test("an unmatched command falls through to the parent app's downstream middleware", async () => {
      const cli = new RhythmCli().command("greet", (ctx) => {
        ctx.response.print("hello");
      });

      const app = new Rhythm<RhythmCliContext>().use(cli.commands()).use((ctx) => {
        ctx.response.exit(1).print("command not found");
      });
      const run = collect(app);

      const result = await run(["unknown"]);
      expect(result.stdout).toBe("command not found");
      expect(result.exitCode).toBe(1);
    });
  });
});
