import { RhythmCli } from "@rhythmjs/cli";
import { withParsedArgv } from "@rhythmjs/cli/argv";
import { withPrompt } from "@rhythmjs/cli/prompt";
import { scaffold } from "./scaffold";

const HELP = `Usage: rhythm <command>

Commands:
  new [name]    Create a new Rhythm project from the template

Options for new:
  --template <url>   Clone a different template (git URL or path)
  --no-install       Skip \`bun install\``;

export const app = new RhythmCli({ name: "rhythm" })
  .use(withParsedArgv())
  .use(withPrompt())
  .use(async (ctx, next) => {
    if (ctx.flags.help || ctx.flags.h) return ctx.log(HELP);
    await next();
  })
  .cmd("", (ctx) => ctx.log(HELP))
  .cmd("help", (ctx) => ctx.log(HELP))
  .cmd("new :name?", async (ctx) => {
    const name = ctx.params.name ?? (await ctx.prompt.text("Project name?", { default: "my-app" }));
    const template = typeof ctx.flags.template === "string" ? ctx.flags.template : undefined;
    try {
      const result = await scaffold({ name, template, install: !ctx.flags["no-install"] });
      ctx.log(`\nCreated ${result.packageName} in ${result.dir}\n\nNext steps:\n  cd ${name}`);
      if (!result.installed) ctx.log("  bun install");
      ctx.log("  bun dev");
    } catch (error) {
      ctx.fail(error instanceof Error ? error.message : String(error));
    }
  });
