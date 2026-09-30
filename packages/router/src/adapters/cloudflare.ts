import type { CloudflareEnv, CloudflareExecutionContext } from "srvx";
import { createFetchAdapter, setRuntime, type AdapterOptions, type FetchAdapter } from "./base";

export type { AdapterOptions };

export const handle: FetchAdapter<[env?: unknown, context?: unknown]> = createFetchAdapter((request, env, context) => {
  if (env !== undefined || context !== undefined) {
    setRuntime(request, {
      name: "cloudflare",
      cloudflare: { env: env as CloudflareEnv, context: context as CloudflareExecutionContext },
    });
  }
});
