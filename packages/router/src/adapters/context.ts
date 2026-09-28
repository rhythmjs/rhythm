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
  json(data: unknown, status?: number): void;
  text(body: string, status?: number): void;
  html(body: string, status?: number): void;
  error(status: number, message?: string): void;
  redirect(url: string, status?: number): void;
}

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  410: "Gone",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

export function createHttpContext(request: Request): RhythmHttpContext {
  const response = new RhythmResponse();
  return {
    request,
    response,
    json(data: unknown, status?: number): void {
      if (status !== undefined) response.status = status;
      response.headers.set("content-type", "application/json; charset=utf-8");
      response.body = JSON.stringify(data);
    },
    text(body: string, status?: number): void {
      if (status !== undefined) response.status = status;
      response.headers.set("content-type", "text/plain; charset=utf-8");
      response.body = body;
    },
    html(body: string, status?: number): void {
      if (status !== undefined) response.status = status;
      response.headers.set("content-type", "text/html; charset=utf-8");
      response.body = body;
    },
    error(status: number, message?: string): void {
      response.status = status;
      response.headers.set("content-type", "text/plain; charset=utf-8");
      response.body = message ?? STATUS_TEXT[status] ?? `Error ${status}`;
    },
    redirect(url: string, status: number = 302): void {
      response.status = status;
      response.headers.set("location", url);
      response.body = null;
    },
  };
}

export function toResponse(response: RhythmResponse): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
