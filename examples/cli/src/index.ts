import { Rhythm, type Middleware } from "@rhythmjs/rhythm";
import { createPrompt, toCliHandler } from "@rhythmjs/cli/adapters/bun";
import type { RhythmCliContext } from "@rhythmjs/cli/adapters/context";
import { RhythmCli } from "@rhythmjs/cli";

const remotes: Record<string, string> = {};

const remoteCli = new RhythmCli({ name: "remote", prefix: "remote" })
  .command("add :name :url", (ctx) => {
    remotes[ctx.args.name] = ctx.args.url;
    ctx.response.print(`added remote "${ctx.args.name}" -> ${ctx.args.url}`);
  })
  .command("list", (ctx) => {
    const lines = Object.entries(remotes).map(([name, url]) => `${name}\t${url}`);
    ctx.response.print(lines.length ? lines.join("\n") : "(no remotes)");
  });

const rootCli = new RhythmCli({ name: "example" })
  .provide(
    () => {
      const created = createPrompt();
      return { prompt: created.prompt, "#close": created.close };
    },
    (value) => value["#close"](),
  )
  .command("init", async (ctx) => {
    const name = await ctx.prompt.text("Project name?", { default: "my-app" });
    const useTypeScript = await ctx.prompt.confirm("Use TypeScript?", { default: true });
    const packageManager = await ctx.prompt.select("Package manager?", ["npm", "pnpm", "bun"] as const, {
      allowCustom: true,
    });
    ctx.response.print(`Created "${name}" (${useTypeScript ? "TypeScript" : "JavaScript"}, ${packageManager})`);
  })
  .use(remoteCli.commands());

const app = new Rhythm<RhythmCliContext>({ name: "app" })
  .use(async (ctx, next) => {
    if (ctx.flags.verbose) console.error(`[cli] argv: ${ctx.argv.join(" ")}`);
    await next();
  })
  .use(rootCli.commands() as unknown as Middleware<RhythmCliContext>)
  .use((ctx) => {
    ctx.response.exit(1).printError(`Unknown command: ${ctx.argv.join(" ") || "(none)"}`);
  });

process.exitCode = await toCliHandler(app)(process.argv.slice(2));
await app.teardown();
