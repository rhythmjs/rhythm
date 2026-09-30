# Rhythm monorepo

This is a Bun workspace (`packages/*`, `examples/*`) built entirely with Bun tooling — there is no Vite+, Turborepo, or pnpm here. The ecosystem is coupled to Bun on purpose: no multi-runtime adapters, no portability shims.

- `bun install` after pulling changes.
- `bun test` at the root runs every package's tests; `bun test` inside a package scopes to it.
- `bun run build` runs each `@rhythmjs/*` package's build (`bun build` for JS + `tsc -p tsconfig.build.json` for declarations) in dependency order via `bun run --filter`.
- `bun run typecheck` type-checks every workspace (`tsc --noEmit`); run `bun run build` first, since packages resolve each other's declarations through `dist/`.
- `bun run check` = prettier check + oxlint + typecheck. `bun run fmt` formats. Prettier config is the root `.prettierrc.json`.
