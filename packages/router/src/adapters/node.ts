import { toNodeHandler } from "srvx/node";
import type { NodeHttp1Handler, NodeHttp2Handler } from "srvx";
import type { Rhythm } from "@rhythmjs/rhythm";
import { createFetchAdapter, type AdapterOptions } from "./base";
import type { RhythmHttpContext } from "../context";

export interface NodeHandlerOptions extends AdapterOptions {
  maxRequestBodySize?: number;
}

export type NodeHandler = NodeHttp1Handler & NodeHttp2Handler;

const fetchHandle = createFetchAdapter();

export function getRequestListener<TContext extends RhythmHttpContext, TProviders extends object = {}>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
  options: NodeHandlerOptions = {},
): NodeHandler {
  return toNodeHandler(fetchHandle(app, options), options) as NodeHandler;
}
