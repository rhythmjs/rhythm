import { Rhythm, mount } from "@rhythmjs/rhythm";
import { RhythmCli } from "@rhythmjs/cli";
import { withParsedArgv } from "@rhythmjs/cli/argv";
import type { RhythmCliContext } from "@rhythmjs/cli/context";
import { error, fail, log } from "@rhythmjs/cli/output";
import { withPrompt } from "@rhythmjs/cli/prompt";
import { toCliHandler } from "@rhythmjs/cli/run";

const remotes: Record<string, string> = {};

const remoteCli = new RhythmCli<RhythmCliContext & { flags: Record<string, string | boolean> }>({ name: "remote" })
  .cmd("remote add :name :url", (ctx) => {
    remotes[ctx.params.name] = ctx.params.url;
    log(ctx, `added remote "${ctx.params.name}" -> ${ctx.params.url}`);
  })
  .cmd(
    "remote remove :name",
    (ctx, next) => {
      if (ctx.flags.force !== true) return fail(ctx, "pass --force to remove a remote");
      return next();
    },
    (ctx) => {
      delete remotes[ctx.params.name];
      log(ctx, `removed remote "${ctx.params.name}"`);
    },
  )
  .cmd("remote list", (ctx) => {
    const lines = Object.entries(remotes).map(([name, url]) => `${name}\t${url}`);
    log(ctx, lines.length ? lines.join("\n") : "(no remotes)");
  });

const rootCli = new RhythmCli({ name: "root" }).use(withPrompt()).cmd("init", async (ctx) => {
  const name = await ctx.prompt.text("Project name?", { default: "my-app" });
  const useTypeScript = await ctx.prompt.confirm("Use TypeScript?", { default: true });
  const packageManager = await ctx.prompt.select("Package manager?", ["npm", "pnpm", "bun"] as const, {
    allowCustom: true,
  });
  log(ctx, `Created "${name}" (${useTypeScript ? "TypeScript" : "JavaScript"}, ${packageManager})`);
});

const app = new Rhythm<{}, RhythmCliContext>({ name: "app" })
  .use(withParsedArgv())
  .use(async (ctx, next) => {
    if (ctx.flags.verbose === true) error(ctx, `[cli] argv: ${ctx.argv.join(" ")}`);
    await next();
  })
  .use(mount(rootCli))
  .use(mount(remoteCli));

process.exitCode = await toCliHandler(app)(process.argv.slice(2));
