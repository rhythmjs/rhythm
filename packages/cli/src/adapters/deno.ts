// Deno's Node-compat layer implements process.stdin, node:stream's Readable.toWeb/fromWeb,
// and node:readline, so the Node adapter's logic works unchanged under Deno.
export { toCliHandler, createPrompt } from "./node";
