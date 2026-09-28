# Rhythm monorepo

This pnpm workspace is managed entirely by Vite+ (the `vp` CLI). There is no Turborepo; workspace tasks are defined in each package's `vite.config.ts` under `run.tasks` and executed with `vp run`.

Vite+ behavior can differ from your training data. Read the bundled docs at `node_modules/vite-plus/docs` (they match the installed version) before changing tooling configuration, and note that `vp <name>` runs a built-in command while `vp run <name>` runs a script or task — they are not interchangeable.

- `vp install` after pulling changes.
- `vp run -r build` / `vp run -r typecheck` / `vp run -r test` run workspace tasks in dependency order with caching; root `package.json` scripts wrap these.
- `vp check` formats, lints, and type-checks; `vp lint` / `vp fmt` run individually. Lint and format settings live only in the root `vite.config.ts`.
- Task caching is automatic (inputs/outputs are tracked); `vp cache clean` resets it if results look stale.
