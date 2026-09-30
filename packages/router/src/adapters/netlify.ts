import { createFetchAdapter, setRuntime, type AdapterOptions, type FetchAdapter } from "./base";

export type { AdapterOptions };

export const handle: FetchAdapter<[context?: unknown]> = createFetchAdapter((request, context) => {
  if (context !== undefined) {
    setRuntime(request, { name: "netlify", netlify: { context } });
  }
});
