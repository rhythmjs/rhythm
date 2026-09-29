import { toLambdaHandler, type AWSLambdaHandler } from "srvx/aws-lambda";
import type { Rhythm } from "@rhythmjs/rhythm";
import { toFetchHandler } from "../fetch";
import type { RhythmHttpContext } from "../context";

export type { AWSLambdaHandler };

export function handle<TContext extends RhythmHttpContext, TProviders extends object = {}>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
): AWSLambdaHandler {
  return toLambdaHandler({ fetch: toFetchHandler(app) });
}
