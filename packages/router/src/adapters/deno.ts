// Deno.serve() accepts a plain (request: Request) => Promise<Response> handler,
// exactly like Bun.serve() does - no Deno-specific conversion is needed.
export { toFetchHandler } from "./bun";
