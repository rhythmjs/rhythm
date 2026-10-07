import type { PipelineOptions } from "./types";

export function wrapFailure(
  verb: "mounted" | "included",
  plugin: { readonly options?: PipelineOptions },
  cause: unknown,
): Error {
  const { type = "module", name = "anonymous" } = plugin.options ?? {};
  return new Error(`${verb} ${type} "${name}" failed`, { cause });
}
