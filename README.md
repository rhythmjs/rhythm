# rhythmjs

Rhythm is an opinionated, Bun-native backend framework. Applications are built the same way every time (encapsulated modules, lifecycle-managed providers, and onion-style middleware) with every context access checked at compile time: no decorators, no reflection, no DI container.

This repository is the framework's core. `@rhythmjs/rhythm` is the composition kernel: it has no router and no HTTP layer of its own, by design; `@rhythmjs/router` (HTTP) and `@rhythmjs/cli` (command-line apps) are built on top of it, and the rest of the ecosystem (config, http, middleware, security, observability, openapi, ws, tasks, testing) builds on those.

Source: [github.com/rhythmjs/rhythm](https://github.com/rhythmjs/rhythm)

## Packages

- **[`packages/rhythm`](./packages/rhythm)**: `@rhythmjs/rhythm`, the core kernel. No dependencies.
- **[`packages/router`](./packages/router)**: `@rhythmjs/router`, HTTP routing on top of `Rhythm`.
- **[`packages/cli`](./packages/cli)**: `@rhythmjs/cli`, CLI command routing on top of `Rhythm`.
- **`examples/router`** and **`examples/cli`**: small runnable programs demonstrating each package.

See each package's own README for its concepts, usage examples, and API.

## Documentation site

The framework-free documentation site lives in the separate `rhythmjs.github.io` repository, alongside this one. It has separate sections for `@rhythmjs/rhythm`, `@rhythmjs/router`, and `@rhythmjs/cli`, each with its own API reference.

Open its `index.html` directly, or serve the folder with any static host. No installation or build step is needed.

## Development

This is a Bun workspace.

```sh
bun install
bun run build # all packages, in dependency order (bun build + tsc declarations)
bun test # every package's tests
bun run typecheck # tsc --noEmit in every workspace (build first)
bun run check # prettier --check + oxlint + typecheck
```

To publish the packages to npm, run `bun run build` and then publish each package from its directory.

## License

ISC
