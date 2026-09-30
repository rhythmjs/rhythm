import { createFetchAdapter, type AdapterOptions, type FetchAdapter } from "./base";

export type { AdapterOptions };

export const handle: FetchAdapter<[info?: unknown]> = createFetchAdapter<[info?: unknown]>();
