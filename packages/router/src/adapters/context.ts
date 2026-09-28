import { RhythmMutable } from "@rhythmjs/rhythm";

export type RhythmResponseBody =
  | string
  | ArrayBuffer
  | Uint8Array
  | Blob
  | FormData
  | URLSearchParams
  | ReadableStream<Uint8Array>
  | null;

export class RhythmResponse {
  readonly [RhythmMutable] = true;

  status: number = 200;
  statusText: string | undefined = undefined;
  headers: Headers = new Headers();
  body: RhythmResponseBody = null;
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
