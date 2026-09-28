import { RhythmMutable } from "../core/rhythm";

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

export function toResponse(response: RhythmResponse): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
