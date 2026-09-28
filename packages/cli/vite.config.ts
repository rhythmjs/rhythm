import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      "rhythm-cli": "src/rhythm-cli.ts",
      argv: "src/argv.ts",
      prompt: "src/prompt.ts",
      "adapters/bun": "src/adapters/bun.ts",
      "adapters/deno": "src/adapters/deno.ts",
      "adapters/node": "src/adapters/node.ts",
      "adapters/context": "src/adapters/context.ts",
    },
    format: "esm",
    dts: true,
    fixedExtension: false,
    clean: true,
  },
  run: {
    tasks: {
      build: {
        command: "vp pack",
        dependsOn: [{ task: "build", from: "dependencies" }],
      },
      typecheck: {
        command: "tsc --noEmit",
        dependsOn: [{ task: "build", from: "dependencies" }],
      },
      test: {
        command: "vp test",
        dependsOn: [{ task: "build", from: "dependencies" }],
      },
    },
  },
});
