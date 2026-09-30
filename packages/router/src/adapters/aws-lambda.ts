import { toLambdaHandler, type AWSLambdaHandler } from "srvx/aws-lambda";
import type { Rhythm } from "@rhythmjs/rhythm";
import { createFetchAdapter, type AdapterOptions } from "./base";
import type { RhythmHttpContext } from "../context";

export type { AdapterOptions, AWSLambdaHandler };

const fetchHandle = createFetchAdapter();

export function handle<TContext extends RhythmHttpContext, TProviders extends object = {}>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
  options: AdapterOptions = {},
): AWSLambdaHandler {
  return toLambdaHandler({ fetch: fetchHandle(app, options) });
}
