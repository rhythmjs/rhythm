import { test, expect } from "bun:test";
import { RhythmResponse, createHttpContext, toResponse } from "./context";
import { text } from "./response";

const newCtx = (path = "/") => createHttpContext(new Request(`http://localhost${path}`));

test("a fresh response holds plain defaults: 200, no body, no headers", () => {
  const response = new RhythmResponse();

  expect(response.status).toBe(200);
  expect(response.statusText).toBe("");
  expect(response.body).toBeNull();
  expect([...response.headers]).toEqual([]);
});

test("response fields are real values: assigning them changes nothing else", () => {
  const response = new RhythmResponse();

  response.body = "hello";

  expect(response.status).toBe(200);
  expect([...response.headers]).toEqual([]);
});

test("createHttpContext carries only the request, server and a fresh response", () => {
  const request = new Request("http://localhost/");
  const ctx = createHttpContext(request);

  expect(ctx.request).toBe(request);
  expect(ctx.response).toBeInstanceOf(RhythmResponse);
  expect(createHttpContext(request).response).not.toBe(ctx.response);
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

test("headers is created on first read and is the same object afterwards", () => {
  const response = new RhythmResponse();

  expect(response.headers).toBe(response.headers);
  response.headers.set("x-id", "7");
  expect(response.headers.get("x-id")).toBe("7");
});
