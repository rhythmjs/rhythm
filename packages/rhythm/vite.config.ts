import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: { rhythm: "src/rhythm.ts" },
    format: "esm",
    dts: true,
    fixedExtension: false,
    clean: true,
  },
});
