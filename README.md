# rhythmjs

A minimal, type-safe composition kernel: onion-style middleware, lifecycle-managed providers, and encapsulated module registration. The core (`@rhythmjs/rhythm`) is framework-agnostic by design — it has no router, no HTTP layer, and never will; everything else in this monorepo is built on top of it.

## Packages

- **[`packages/rhythm`](./packages/rhythm)** — `@rhythmjs/rhythm`, the core kernel. No dependencies.
- **[`packages/router`](./packages/router)** — `@rhythmjs/router`, HTTP routing on top of `Rhythm`.
- **[`packages/cli`](./packages/cli)** — `@rhythmjs/cli`, CLI command routing on top of `Rhythm`.
- **`examples/router`** and **`examples/cli`** — small runnable programs demonstrating each package.

See each package's own README for its concepts, usage examples, and API.

## Documentation site

The framework-free documentation site lives in [`apps/docs`](./apps/docs). It includes guides for the core, router, CLI, lifecycle, and runtime adapters, plus an API reference.

```sh
bun run docs:dev     # http://localhost:3001
bun run docs:build   # static output in apps/docs/dist
```

## Development

This is a Turborepo-managed Bun workspace.

```sh
bun install
bun run test         # turbo run test — all packages
bun run typecheck    # turbo run typecheck — all packages
```

## License

ISC
