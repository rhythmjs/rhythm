import { RhythmMutable, type Rhythm } from "../core/rhythm";

export class RhythmResponse {
  readonly [RhythmMutable] = true;

  status: number = 200;
  statusText: string | undefined = undefined;
  headers: Headers = new Headers();
  body: Bun.BodyInit | null = null;
}

export interface RhythmHttpContext {
  request: Request;
  response: RhythmResponse;
}

function toResponse(response: RhythmResponse): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function toFetchHandler<TContext extends RhythmHttpContext, TProviders extends object = {}>(
  app: Rhythm<RhythmHttpContext, TContext, TProviders>,
): (request: Request) => Promise<Response> {
  const run = app.callback();
  return async (request: Request): Promise<Response> => {
    const ctx = await run({ request, response: new RhythmResponse() });
    return toResponse(ctx.response);
  };
}
