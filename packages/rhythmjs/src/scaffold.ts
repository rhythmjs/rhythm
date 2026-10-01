import { existsSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { rm } from "node:fs/promises";

export const DEFAULT_TEMPLATE = "https://github.com/rhythmjs/template";

const PACKAGE_NAME = /^[a-z0-9][a-z0-9._~-]*$/;

export interface ScaffoldOptions {
  name: string;
  template?: string;
  install?: boolean;
}

export interface ScaffoldResult {
  dir: string;
  packageName: string;
  installed: boolean;
}

export function validateName(name: string): string | null {
  const packageName = basename(resolve(name));
  if (!PACKAGE_NAME.test(packageName)) {
    return `"${packageName}" is not a valid project name (lowercase letters, numbers, ".", "_", "~" and "-" only).`;
  }
  return null;
}

async function run(cmd: string[], cwd?: string, inherit = false): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdin: "ignore",
    stdout: inherit ? "inherit" : "ignore",
    stderr: inherit ? "inherit" : "pipe",
  });
  const code = await proc.exited;
  if (code !== 0 && !inherit && proc.stderr) {
    const message = (await new Response(proc.stderr).text()).trim();
    if (message) console.error(message);
  }
  return code;
}

export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const invalid = validateName(options.name);
  if (invalid) throw new Error(invalid);

  const dir = resolve(options.name);
  const packageName = basename(dir);

  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(`Directory "${options.name}" already exists and is not empty.`);
  }

  const template = options.template ?? DEFAULT_TEMPLATE;
  if ((await run(["git", "clone", "--depth", "1", template, dir])) !== 0) {
    throw new Error(`Could not clone template ${template}. Is git installed and the template reachable?`);
  }

  await rm(resolve(dir, ".git"), { recursive: true, force: true });
  await run(["git", "init"], dir);

  const pkgPath = resolve(dir, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = await Bun.file(pkgPath).json();
    pkg.name = packageName;
    await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  let installed = false;
  if (options.install !== false && existsSync(pkgPath)) {
    installed = (await run(["bun", "install"], dir, true)) === 0;
  }

  return { dir, packageName, installed };
}
