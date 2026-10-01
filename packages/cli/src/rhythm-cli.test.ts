import { describe, expect, test } from "bun:test";
import { Rhythm } from "@rhythmjs/rhythm";
import type { DeriveMiddleware, Middleware } from "@rhythmjs/rhythm/types";
import { RhythmCliResponse, type RhythmCliContext } from "./context";
import { toCliHandler } from "./run";
import { RhythmCli } from "./rhythm-cli";

const host = (cli: RhythmCli<any>) => new Rhythm<RhythmCliContext>().use(cli.middleware());

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

  test("a trailing :param? is optional: absent when omitted, captured when given", async () => {
    const cli = new RhythmCli().command("new :name?", (ctx) => {
      ctx.response.print(`name=${ctx.args.name ?? "none"}`);
    });
    const run = collect(host(cli));

    expect((await run(["new"])).stdout).toBe("name=none");
    expect((await run(["new", "app"])).stdout).toBe("name=app");
    expect((await run(["new", "app", "extra"])).stdout).toBe("");
  });

  test("a required param after an optional one is rejected", () => {
    expect(() => new RhythmCli().command("new :name? :dir", () => {})).toThrow("must come last");
  });

  test("a trailing ** catch-all captures the remaining positionals in args._, joined by spaces", async () => {
    const cli = new RhythmCli().command("run :script **", (ctx) => {
      ctx.response.print(`${ctx.args.script}|${ctx.args._ ?? "none"}`);
    });
    const run = collect(host(cli));

    expect((await run(["run", "build"])).stdout).toBe("build|none");
    expect((await run(["run", "build", "a", "b"])).stdout).toBe("build|a b");
    expect((await run(["run"])).stdout).toBe("");
  });

  test("a catch-all must be last and unique", () => {
    expect(() => new RhythmCli().command("run ** :x", () => {})).toThrow("must come last");
    expect(() => new RhythmCli().command("run ** **", () => {})).toThrow();
  });

  test("falls through when the command path doesn't match: no output, default exit code", async () => {
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

  test("registration order is execution order: use() after a command doesn't wrap that command", async () => {
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

  test("a derive middleware in the command's middleware slot types the handler", async () => {
    const withUser = (() => {
      const middleware: Middleware<RhythmCliContext> = async (ctx, next) => {
        Object.assign(ctx, { user: "ada" });
        await next();
      };
      return middleware as DeriveMiddleware<RhythmCliContext, { user: string }>;
    })();

    const cli = new RhythmCli().command("greet :name", withUser, (ctx) => {
      ctx.response.print(`${ctx.user} greets ${ctx.args.name}`);
    });

    const result = await collect(host(cli))(["greet", "grace"]);
    expect(result.stdout).toBe("ada greets grace");
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

  test("a cli is a controller, not a module: it exposes no register() or provide()", () => {
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

    test("a child cli mounted via use(child.middleware()) serves under its own prefix", async () => {
      const remoteCli = new RhythmCli({ prefix: "remote" }).command("add :name", (ctx) => {
        ctx.response.print(ctx.args.name);
      });
      const gitCli = new RhythmCli().use(remoteCli.middleware());
      const run = collect(host(gitCli));

      expect((await run(["remote", "add", "origin"])).stdout).toBe("origin");
      expect((await run(["add", "origin"])).stdout).toBe("");
    });

    test("nesting is wiring only: a parent's prefix does not re-prefix a mounted child's commands", async () => {
      const remoteCli = new RhythmCli({ prefix: "git remote" }).command("add :name", (ctx) => {
        ctx.response.print(ctx.args.name);
      });
      const rootCli = new RhythmCli({ prefix: "vcs" }).use(remoteCli.middleware());
      const run = collect(host(rootCli));

      expect((await run(["git", "remote", "add", "origin"])).stdout).toBe("origin");
      expect((await run(["vcs", "git", "remote", "add", "origin"])).stdout).toBe("");
    });
  });

  describe("middleware(), mounted via a parent's use() (koa-style)", () => {
    test("a matched command short-circuits the parent app's downstream middleware", async () => {
      const cli = new RhythmCli().command("greet", (ctx) => {
        ctx.response.print("hello");
      });

      const app = new Rhythm<RhythmCliContext>().use(cli.middleware()).use((ctx) => {
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

      const app = new Rhythm<RhythmCliContext>().use(cli.middleware()).use((ctx) => {
        ctx.response.exit(1).print("command not found");
      });
      const run = collect(app);

      const result = await run(["unknown"]);
      expect(result.stdout).toBe("command not found");
      expect(result.exitCode).toBe(1);
    });
  });
});
