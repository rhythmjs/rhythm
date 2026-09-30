import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      "rhythm-router": "src/rhythm-router.ts",
      context: "src/context.ts",
      fetch: "src/fetch.ts",
      serve: "src/serve.ts",
      "adapters/node": "src/adapters/node.ts",
      "adapters/bun": "src/adapters/bun.ts",
      "adapters/deno": "src/adapters/deno.ts",
      "adapters/vercel": "src/adapters/vercel.ts",
      "adapters/netlify": "src/adapters/netlify.ts",
      "adapters/cloudflare": "src/adapters/cloudflare.ts",
      "adapters/aws-lambda": "src/adapters/aws-lambda.ts",
      "adapters/service-worker": "src/adapters/service-worker.ts",
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
