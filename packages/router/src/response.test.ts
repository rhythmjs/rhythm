import { test, expect } from "bun:test";
import { createHttpContext, toResponse } from "./context";
import { STATUS_TEXT, error, html, json, redirect, text } from "./response";

const newCtx = (path = "/") => createHttpContext(new Request(`http://localhost${path}`));

test("json stringifies the data, sets the content type, and keeps the status unless given", () => {
  const ctx = newCtx();
  json(ctx, { ok: true });

  expect(ctx.response.body).toBe('{"ok":true}');
  expect(ctx.response.status).toBe(200);
  expect(ctx.response.headers.get("content-type")).toBe("application/json; charset=utf-8");

  const created = newCtx();
  json(created, [1, 2], 201);

  expect(created.response.body).toBe("[1,2]");
  expect(created.response.status).toBe(201);
});

test("text and html set their content types", () => {
  const textCtx = newCtx();
  text(textCtx, "hello", 202);
  const htmlCtx = newCtx();
  html(htmlCtx, "<h1>hi</h1>");

  expect(textCtx.response.body).toBe("hello");
  expect(textCtx.response.status).toBe(202);
  expect(textCtx.response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(htmlCtx.response.body).toBe("<h1>hi</h1>");
  expect(htmlCtx.response.headers.get("content-type")).toBe("text/html; charset=utf-8");
});

test("a helper does not reset a status that was set earlier", () => {
  const ctx = newCtx();
  ctx.response.status = 418;
  text(ctx, "short and stout");

  expect(ctx.response.status).toBe(418);
});

test("error sets the status and defaults the message to the status text", () => {
  const known = newCtx();
  error(known, 404);
  const custom = newCtx();
  error(custom, 422, "name is required");
  const unknown = newCtx();
  error(unknown, 499);

  expect(known.response.status).toBe(404);
  expect(known.response.body).toBe("Not Found");
  expect(custom.response.status).toBe(422);
  expect(custom.response.body).toBe("name is required");
  expect(unknown.response.body).toBe("Error 499");
  expect(STATUS_TEXT[404]).toBe("Not Found");
});

test("redirect sets the status and location, and empties the body", () => {
  const ctx = newCtx();
  text(ctx, "stale");
  redirect(ctx, "/elsewhere");

  expect(ctx.response.status).toBe(302);
  expect(ctx.response.headers.get("location")).toBe("/elsewhere");
  expect(ctx.response.body).toBeNull();

  const permanent = newCtx();
  redirect(permanent, "/new", 301);

  expect(permanent.response.status).toBe(301);
});

test("redirect rejects statuses that are not redirects", () => {
  expect(() => redirect(newCtx(), "/x", 200)).toThrow(RangeError);
});

test("a content type set by a helper is visible through headers, and later writes win", () => {
  const ctx = newCtx();
  json(ctx, {});
  expect(ctx.response.headers.get("content-type")).toBe("application/json; charset=utf-8");

  ctx.response.headers.set("content-type", "application/problem+json");
  text(ctx, "late");
  expect(ctx.response.headers.get("content-type")).toBe("text/plain; charset=utf-8");

  const early = newCtx();
  text(early, "x");
  early.response.headers.set("content-type", "text/csv");
  expect(toResponse(early.response).headers.get("content-type")).toBe("text/csv");
});
