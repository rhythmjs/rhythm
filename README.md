# rhythmjs

A minimal, type-safe composition kernel: onion-style middleware, lifecycle-managed providers, and encapsulated module registration. The core (`@rhythmjs/rhythm`) is framework-agnostic by design — it has no router, no HTTP layer, and never will; everything else in this monorepo is built on top of it.

Source: [github.com/rhythmjs/rhythm](https://github.com/rhythmjs/rhythm)

## Packages

- **[`packages/rhythm`](./packages/rhythm)** — `@rhythmjs/rhythm`, the core kernel. No dependencies.
- **[`packages/router`](./packages/router)** — `@rhythmjs/router`, HTTP routing on top of `Rhythm`.
- **[`packages/cli`](./packages/cli)** — `@rhythmjs/cli`, CLI command routing on top of `Rhythm`.
- **`examples/router`** and **`examples/cli`** — small runnable programs demonstrating each package.

See each package's own README for its concepts, usage examples, and API.

## Documentation site

The framework-free documentation site lives in the separate `rhythmjs.github.io` repository, alongside this one. It has separate sections for `@rhythmjs/rhythm`, `@rhythmjs/router`, and `@rhythmjs/cli`, each with its own API reference.

Open its `index.html` directly, or serve the folder with any static host. No installation or build step is needed.

## Development

This is a Turborepo-managed pnpm workspace.

```sh
pnpm install
pnpm build           # turbo run build — all packages (vp pack)
pnpm test            # turbo run test — all packages (vp test / vitest)
pnpm typecheck       # turbo run typecheck — all packages
```

To publish the packages to npm, run `pnpm build` and then `pnpm -r publish` from the repository root.

## License

ISC
