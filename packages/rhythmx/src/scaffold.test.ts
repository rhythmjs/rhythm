import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold, validateName } from "./scaffold";

let root: string;
let template: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "rhythmjs-"));
  template = join(root, "template");
  mkdirSync(template);
  writeFileSync(join(template, "package.json"), JSON.stringify({ name: "template", version: "1.0.0" }));
  writeFileSync(join(template, "index.ts"), "export {};\n");
  const git = (...args: string[]) =>
    Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: template });
  git("init");
  git("add", ".");
  git("commit", "-m", "init");
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe("scaffold", () => {
  test("clones the template, renames the package and resets git history", async () => {
    const target = join(root, "my-app");
    const result = await scaffold({ name: target, template, install: false });

    expect(result.packageName).toBe("my-app");
    expect(existsSync(join(target, "index.ts"))).toBe(true);
    expect((await Bun.file(join(target, "package.json")).json()).name).toBe("my-app");
    const log = Bun.spawnSync(["git", "log"], { cwd: target });
    expect(log.exitCode).not.toBe(0);
  });

  test("refuses a non-empty directory", async () => {
    const target = join(root, "taken");
    mkdirSync(target);
    writeFileSync(join(target, "file"), "x");
    expect(scaffold({ name: target, template, install: false })).rejects.toThrow("not empty");
  });

  test("rejects invalid names", () => {
    expect(validateName("My App")).not.toBeNull();
    expect(validateName("my-app")).toBeNull();
  });
});
