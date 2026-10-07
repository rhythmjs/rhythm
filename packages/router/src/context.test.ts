import { test, expect } from "bun:test";
import { RhythmResponse, STATUS_TEXT, createHttpContext, toResponse } from "./context";

const newCtx = (path = "/") => createHttpContext(new Request(`http://localhost${path}`));

test("a fresh response holds plain defaults: 200, no body, no headers", () => {
  const response = new RhythmResponse();

  expect(response.status).toBe(200);
  expect(response.statusText).toBeUndefined();
  expect(response.body).toBeNull();
  expect([...response.headers]).toEqual([]);
});

test("response fields are real values: assigning them changes nothing else", () => {
  const response = new RhythmResponse();

  response.body = "hello";

  expect(response.status).toBe(200);
  expect([...response.headers]).toEqual([]);
});

test("createHttpContext carries the request and a fresh response", () => {
  const request = new Request("http://localhost/");
  const ctx = createHttpContext(request);

  expect(ctx.request).toBe(request);
  expect(ctx.response).toBeInstanceOf(RhythmResponse);
  expect(createHttpContext(request).response).not.toBe(ctx.response);
});

test("json stringifies the data, sets the content type, and keeps the status unless given", () => {
  const ctx = newCtx();
  ctx.json({ ok: true });

  expect(ctx.response.body).toBe('{"ok":true}');
  expect(ctx.response.status).toBe(200);
  expect(ctx.response.headers.get("content-type")).toBe("application/json; charset=utf-8");

  const created = newCtx();
  created.json([1, 2], 201);

  expect(created.response.body).toBe("[1,2]");
  expect(created.response.status).toBe(201);
});

test("text and html set their content types", () => {
  const text = newCtx();
  text.text("hello", 202);
  const html = newCtx();
  html.html("<h1>hi</h1>");

  expect(text.response.body).toBe("hello");
  expect(text.response.status).toBe(202);
  expect(text.response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(html.response.body).toBe("<h1>hi</h1>");
  expect(html.response.headers.get("content-type")).toBe("text/html; charset=utf-8");
});

test("a helper does not reset a status that was set earlier", () => {
  const ctx = newCtx();
  ctx.response.status = 418;
  ctx.text("short and stout");

  expect(ctx.response.status).toBe(418);
});

test("error sets the status and defaults the message to the status text", () => {
  const known = newCtx();
  known.error(404);
  const custom = newCtx();
  custom.error(422, "name is required");
  const unknown = newCtx();
  unknown.error(499);

  expect(known.response.status).toBe(404);
  expect(known.response.body).toBe("Not Found");
  expect(custom.response.status).toBe(422);
  expect(custom.response.body).toBe("name is required");
  expect(unknown.response.body).toBe("Error 499");
  expect(STATUS_TEXT[404]).toBe("Not Found");
});

test("redirect sets the status and location, and empties the body", () => {
  const ctx = newCtx();
  ctx.text("stale");
  ctx.redirect("/elsewhere");

  expect(ctx.response.status).toBe(302);
  expect(ctx.response.headers.get("location")).toBe("/elsewhere");
  expect(ctx.response.body).toBeNull();

  const permanent = newCtx();
  permanent.redirect("/new", 301);

  expect(permanent.response.status).toBe(301);
});

test("redirect rejects statuses that are not redirects", () => {
  expect(() => newCtx().redirect("/x", 200)).toThrow(RangeError);
});

test("toResponse carries status, statusText, headers and body", async () => {
  const response = new RhythmResponse();
  response.status = 201;
  response.statusText = "Made It";
  response.headers.set("x-id", "7");
  response.body = "ok";

  const out = toResponse(response);

  expect(out.status).toBe(201);
  expect(out.statusText).toBe("Made It");
  expect(out.headers.get("x-id")).toBe("7");
  expect(await out.text()).toBe("ok");
});

test("toResponse passes binary, form and stream bodies through", async () => {
  const bytes = new RhythmResponse();
  bytes.body = new Uint8Array([1, 2, 3]);
  const form = new RhythmResponse();
  form.body = new URLSearchParams({ a: "1" });
  const stream = new RhythmResponse();
  stream.body = new Blob(["streamed"]).stream();

  expect(new Uint8Array(await toResponse(bytes).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  expect(await toResponse(form).text()).toBe("a=1");
  expect(await toResponse(stream).text()).toBe("streamed");
});
