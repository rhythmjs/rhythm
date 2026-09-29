import { toNodeHandler } from "srvx/node";
import type { NodeHttpHandler } from "srvx";
import type { Rhythm } from "@rhythmjs/rhythm";
import { toFetchHandler } from "../fetch";
import { errorToResponse } from "../serve";
import type { RhythmHttpContext } from "../context";

export interface NodeHandlerOptions {
  maxRequestBodySize?: number;
}

export function handle<TContext extends RhythmHttpContext, TProviders extends object = {}>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
  options: NodeHandlerOptions = {},
): NodeHttpHandler {
  const handler = toFetchHandler(app);
  const safeHandler = async (request: Request): Promise<Response> => {
    try {
      return await handler(request);
    } catch (error) {
      return errorToResponse(error);
    }
  };
  return toNodeHandler(safeHandler, options);
}
