import { describe, expect, test } from "bun:test";
import { RhythmMutable } from "@rhythmjs/rhythm";
import { RhythmResponse, toResponse } from "./context";

describe("RhythmResponse", () => {
  test("defaults to status 200, no body, empty headers", () => {
    const response = new RhythmResponse();
    expect(response.status).toBe(200);
    expect(response.statusText).toBeUndefined();
    expect(response.body).toBeNull();
    expect([...response.headers.entries()]).toEqual([]);
  });

  test("carries the RhythmMutable brand so it opts out of DeepReadonly", () => {
    const response = new RhythmResponse();
    expect(response[RhythmMutable]).toBe(true);
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
