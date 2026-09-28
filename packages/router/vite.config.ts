import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      "rhythm-router": "src/rhythm-router.ts",
      "radix-tree": "src/radix-tree.ts",
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
