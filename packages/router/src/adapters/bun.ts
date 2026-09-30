import { createFetchAdapter, type AdapterOptions, type FetchAdapter } from "./base";

export type { AdapterOptions };

export const handle: FetchAdapter<[server?: unknown]> = createFetchAdapter<[server?: unknown]>();
