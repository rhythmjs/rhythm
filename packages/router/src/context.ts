export type RhythmResponseBody =
  string | ArrayBuffer | Uint8Array | Blob | FormData | URLSearchParams | ReadableStream<Uint8Array> | null;

export class RhythmResponse {
  status: number = 200;
  statusText: string = "";
  body: RhythmResponseBody = null;

  #headers?: Headers;

  get headers(): Headers {
    return (this.#headers ??= new Headers());
  }
}

export interface RhythmHttpContext {
  readonly request: Request;
  readonly server: Bun.Server<any> | undefined;
  readonly response: RhythmResponse;
}

export function createHttpContext(request: Request, server?: Bun.Server<any>): RhythmHttpContext {
  return { request, server, response: new RhythmResponse() };
}

export function toResponse(response: RhythmResponse): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
