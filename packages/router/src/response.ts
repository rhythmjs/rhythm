import type { RhythmResponse } from "./context";

export type HasResponse = { readonly response: RhythmResponse };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const STATUS_TEXT: Record<number, string> = {
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

export function json(ctx: HasResponse, data: unknown, status?: number): void {
  const { response } = ctx;
  if (status !== undefined) response.status = status;
  response.headers.set("content-type", "application/json; charset=utf-8");
  response.body = JSON.stringify(data);
}

export function text(ctx: HasResponse, body: string, status?: number): void {
  const { response } = ctx;
  if (status !== undefined) response.status = status;
  response.headers.set("content-type", "text/plain; charset=utf-8");
  response.body = body;
}

export function html(ctx: HasResponse, body: string, status?: number): void {
  const { response } = ctx;
  if (status !== undefined) response.status = status;
  response.headers.set("content-type", "text/html; charset=utf-8");
  response.body = body;
}

export function error(ctx: HasResponse, status: number, message?: string): void {
  const { response } = ctx;
  response.status = status;
  response.headers.set("content-type", "text/plain; charset=utf-8");
  response.body = message ?? STATUS_TEXT[status] ?? `Error ${status}`;
}

export function redirect(ctx: HasResponse, url: string, status: number = 302): void {
  if (!REDIRECT_STATUSES.has(status))
    throw new RangeError(`redirect status must be 301, 302, 303, 307 or 308, got ${status}`);
  const { response } = ctx;
  response.status = status;
  response.headers.set("location", url);
  response.body = null;
}
