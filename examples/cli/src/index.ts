import { Rhythm } from "@rhythmjs/rhythm";
import { createPrompt, toCliHandler } from "@rhythmjs/cli/run";
import type { RhythmCliContext } from "@rhythmjs/cli/context";
import type { RhythmPrompt } from "@rhythmjs/cli/prompt";
import { RhythmCli } from "@rhythmjs/cli";

const remotes: Record<string, string> = {};

const remoteCli = new RhythmCli({ prefix: "remote" })
  .use(
    async (ctx, next) => {
      if (ctx.flags.force !== true) return void ctx.response.exit(1).printError("pass --force to remove a remote");
      await next();
    },
    (ctx) => ctx.argv[1] === "remove",
  )
  .command("add :name :url", (ctx) => {
    remotes[ctx.args.name] = ctx.args.url;
    ctx.response.print(`added remote "${ctx.args.name}" -> ${ctx.args.url}`);
  })
  .command("remove :name", (ctx) => {
    delete remotes[ctx.args.name];
    ctx.response.print(`removed remote "${ctx.args.name}"`);
  })
  .command("list", (ctx) => {
    const lines = Object.entries(remotes).map(([name, url]) => `${name}\t${url}`);
    ctx.response.print(lines.length ? lines.join("\n") : "(no remotes)");
  });

const rootCli = new RhythmCli<RhythmCliContext & { prompt: RhythmPrompt }>()
  .command("init", async (ctx) => {
    const name = await ctx.prompt.text("Project name?", { default: "my-app" });
    const useTypeScript = await ctx.prompt.confirm("Use TypeScript?", { default: true });
    const packageManager = await ctx.prompt.select("Package manager?", ["npm", "pnpm", "bun"] as const, {
      allowCustom: true,
    });
    ctx.response.print(`Created "${name}" (${useTypeScript ? "TypeScript" : "JavaScript"}, ${packageManager})`);
  })
  .use(remoteCli.middleware());

const { prompt, close } = createPrompt();

const app = new Rhythm<RhythmCliContext, { prompt: RhythmPrompt }>({ name: "app" })
  .use(
    async (ctx, next) => {
      console.error(`[cli] argv: ${ctx.argv.join(" ")}`);
      await next();
    },
    (ctx) => ctx.flags.verbose === true,
  )
  .use(rootCli.middleware())
  .use((ctx) => {
    ctx.response.exit(1).printError(`Unknown command: ${ctx.argv.join(" ") || "(none)"}`);
  });

app.context.prompt = prompt;

process.exitCode = await toCliHandler(app)(process.argv.slice(2));
close();
