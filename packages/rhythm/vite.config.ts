import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: { rhythm: "src/rhythm.ts", compose: "src/compose.ts", types: "src/types.ts" },
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
