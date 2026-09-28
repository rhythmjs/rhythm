import { describe, expect, test } from "bun:test";
import { Rhythm } from "../core/rhythm";
import { RhythmCliResponse, type RhythmCliContext } from "./adapters/context";
import { toCliHandler } from "./adapters/bun";
import { RhythmCli } from "./rhythm-cli";

function collect(app: Rhythm<RhythmCliContext, any, any>) {
  return async (argv: string[]) => {
    const ctx = await app.run({ argv, flags: {}, stdin: null, response: new RhythmCliResponse() });
    return { stdout: ctx.response.stdout.join("\n"), stderr: ctx.response.stderr.join("\n"), exitCode: ctx.response.exitCode };
  };
}

describe("RhythmCli", () => {
  test("matches a command path and extracts named args", async () => {
    const cli = new RhythmCli().command("deploy :environment", (ctx) => {
      ctx.response.print(`deploying to ${ctx.args.environment}`);
    });
    const run = collect(cli);

    const result = await run(["deploy", "production"]);
    expect(result.stdout).toBe("deploying to production");
    expect(result.exitCode).toBe(0);
  });

  test("falls through when the command path doesn't match - no output, default exit code", async () => {
    const cli = new RhythmCli().command("deploy :environment", (ctx) => {
      ctx.response.print("deployed");
    });
    const run = collect(cli);

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

    await toCliHandler(cli)(["deploy", "staging"]);
    expect(events).toEqual(["auth:before", "handler:staging", "auth:after"]);
  });

  test("register() is disabled on a cli - a controller doesn't compose other modules/controllers", () => {
    const cli = new RhythmCli();
    const other = new Rhythm<RhythmCliContext>();

    expect(() => (cli as any).register(other)).toThrow(
      "RhythmCli is a controller and cannot register() other modules or controllers",
    );
  });

  describe("prefix", () => {
    test("commands are matched under the configured prefix, and not without it", async () => {
      const cli = new RhythmCli({ prefix: "remote" }).command("add :name", (ctx) => {
        ctx.response.print(ctx.args.name);
      });
      const run = collect(cli);

      expect((await run(["remote", "add", "origin"])).stdout).toBe("origin");
      expect((await run(["add", "origin"])).stdout).toBe("");
    });

    test("a parent cli's prefix applies to a child cli mounted via use(child.commands())", async () => {
      const remoteCli = new RhythmCli({ name: "remote-cli" }).command("add :name", (ctx) => {
        ctx.response.print(ctx.args.name);
      });
      const gitCli = new RhythmCli({ name: "git", prefix: "remote" }).use(remoteCli.commands());
      const run = collect(gitCli);

      expect((await run(["remote", "add", "origin"])).stdout).toBe("origin");
      expect((await run(["add", "origin"])).stdout).toBe("");
    });

    test("prefixes compose across multiple levels of nesting", async () => {
      const remoteCli = new RhythmCli({ name: "remote" }).command("add :name", (ctx) => {
        ctx.response.print(ctx.args.name);
      });
      const gitCli = new RhythmCli({ name: "git", prefix: "git" }).use(remoteCli.commands());
      const rootCli = new RhythmCli({ name: "root", prefix: "vcs" }).use(gitCli.commands());
      const run = collect(rootCli);

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
