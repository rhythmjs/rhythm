import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: ["**/dist/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ["**/*.test.ts"],
        rules: {
          // The skipped type-system tests use bare property accesses that exist
          // only for the type checker to evaluate.
          "no-unused-expressions": "off",
        },
      },
    ],
  },
  fmt: {
    ignorePatterns: ["**/dist/**"],
    printWidth: 120,
    singleQuote: false,
    semi: true,
  },
});
