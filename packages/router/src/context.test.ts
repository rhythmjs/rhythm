import { describe, expect, test } from "bun:test";
import { createHttpContext, RhythmResponse, toResponse } from "./context";

describe("RhythmResponse", () => {
  test("defaults to status 200, no body, empty headers", () => {
    const response = new RhythmResponse();
    expect(response.status).toBe(200);
    expect(response.statusText).toBeUndefined();
    expect(response.body).toBeNull();
    expect([...response.headers.entries()]).toEqual([]);
  });

  test.skip("type system: the input side of the context is readonly", () => {
    const ctx = createHttpContext(new Request("http://localhost/"));
    // @ts-expect-error the request binding is readonly
    ctx.request = new Request("http://localhost/other");
    // @ts-expect-error the response binding is readonly (its fields stay mutable)
    ctx.response = new RhythmResponse();
    ctx.response.status = 404;
  });

  test("fields are directly mutable, koa-style", () => {
    const response = new RhythmResponse();
    response.status = 404;
    response.statusText = "Not Found";
    response.body = "nope";
    response.headers.set("x-test", "yes");

    expect(response.status).toBe(404);
    expect(response.statusText).toBe("Not Found");
    expect(response.body).toBe("nope");
    expect(response.headers.get("x-test")).toBe("yes");
  });
});

describe("createHttpContext() helpers", () => {
  const request = new Request("http://localhost/");

  test("json() sets the content type, serializes the body, and keeps status 200 by default", () => {
    const ctx = createHttpContext(request);
    ctx.json({ id: 1 });

    expect(ctx.response.status).toBe(200);
    expect(ctx.response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(ctx.response.body).toBe('{"id":1}');
  });

  test("json() accepts an optional status", () => {
    const ctx = createHttpContext(request);
    ctx.json({ id: 1 }, 201);
    expect(ctx.response.status).toBe(201);
  });

  test("text() sets a plain-text body", () => {
    const ctx = createHttpContext(request);
    ctx.text("hello", 202);

    expect(ctx.response.status).toBe(202);
    expect(ctx.response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(ctx.response.body).toBe("hello");
  });

  test("html() sets an html body", () => {
    const ctx = createHttpContext(request);
    ctx.html("<h1>hi</h1>");

    expect(ctx.response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(ctx.response.body).toBe("<h1>hi</h1>");
  });

  test("error() defaults the message from the status code", () => {
    const ctx = createHttpContext(request);
    ctx.error(404);

    expect(ctx.response.status).toBe(404);
    expect(ctx.response.body).toBe("Not Found");
  });

  test("error() accepts a custom message and falls back for unknown statuses", () => {
    const custom = createHttpContext(request);
    custom.error(404, "user not found");
    expect(custom.response.body).toBe("user not found");

    const unknown = createHttpContext(request);
    unknown.error(418);
    expect(unknown.response.body).toBe("Error 418");
  });

  test("redirect() sets the location header, a 302 default, and no body", () => {
    const ctx = createHttpContext(request);
    ctx.redirect("/login");

    expect(ctx.response.status).toBe(302);
    expect(ctx.response.headers.get("location")).toBe("/login");
    expect(ctx.response.body).toBeNull();

    ctx.redirect("/moved", 301);
    expect(ctx.response.status).toBe(301);
  });

  test("redirect() rejects non-redirect statuses", () => {
    const ctx = createHttpContext(request);

    expect(() => ctx.redirect("/x", 200)).toThrow(RangeError);
    expect(() => ctx.redirect("/x", 404)).toThrow("301, 302, 303, 307 or 308");
    expect(ctx.response.headers.get("location")).toBeNull();
    for (const status of [301, 302, 303, 307, 308]) {
      ctx.redirect("/ok", status);
      expect(ctx.response.status).toBe(status);
    }
  });

  test("helpers survive context spreading because they close over the shared response", () => {
    const ctx = createHttpContext(request);
    const spread = { ...ctx, params: { id: "1" } };
    spread.json({ ok: true });

    expect(ctx.response.body).toBe('{"ok":true}');
  });
});

describe("toResponse()", () => {
  test("builds a real Response reflecting the RhythmResponse's current state", async () => {
    const rhythmResponse = new RhythmResponse();
    rhythmResponse.status = 201;
    rhythmResponse.statusText = "Created";
    rhythmResponse.body = "hello";
    rhythmResponse.headers.set("content-type", "text/plain");

    const response = toResponse(rhythmResponse);

    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(await response.text()).toBe("hello");
  });

  test("a null body produces an empty response body", async () => {
    const response = toResponse(new RhythmResponse());
    expect(await response.text()).toBe("");
  });
});
