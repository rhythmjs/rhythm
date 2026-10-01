import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmCli, type RhythmCliCommandContext } from "@rhythmjs/cli";
import type { Middleware } from "@rhythmjs/rhythm/types";
import { createPrompt } from "@rhythmjs/cli/run";
import type { RhythmCliContext } from "@rhythmjs/cli/context";
import { scaffold } from "./scaffold";

const HELP = `Usage: rhythm <command>

Commands:
  new [name]    Create a new Rhythm project from the template

Options for new:
  --template <url>   Clone a different template (git URL or path)
  --no-install       Skip \`bun install\``;

const cli = new RhythmCli<RhythmCliContext>();

const create: Middleware<RhythmCliContext & RhythmCliCommandContext> = async (ctx) => {
  let name: string | undefined = ctx.args["name"];
  if (!name) {
    const { prompt, close } = createPrompt();
    name = await prompt.text("Project name?", { default: "my-app" });
    close();
  }

  const template = typeof ctx.flags.template === "string" ? ctx.flags.template : undefined;
  try {
    const result = await scaffold({ name, template, install: !ctx.flags["no-install"] });
    ctx.response.print(`\nCreated ${result.packageName} in ${result.dir}\n\nNext steps:\n  cd ${name}`);
    if (!result.installed) ctx.response.print("  bun install");
    ctx.response.print("  bun dev");
  } catch (error) {
    ctx.response.exit(1).printError(error instanceof Error ? error.message : String(error));
  }
};

cli.command("new :name?", create);

export const app = new Rhythm<RhythmCliContext>({ name: "rhythm" }).use(cli.middleware()).use((ctx) => {
  const unknown = ctx.argv.length > 0 && !ctx.flags.help && !ctx.flags.h;
  if (unknown) ctx.response.exit(1).printError(`Unknown command: ${ctx.argv.join(" ")}\n`);
  ctx.response.print(HELP);
});
