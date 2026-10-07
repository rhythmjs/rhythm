import { describe, expect, test } from "bun:test";
import { Rhythm, mount } from "@rhythmjs/rhythm";
import { RhythmRouter } from "./rhythm-router";
import { fromFetch, toFetchHandler } from "./fetch";
import { pathIs } from "./path";

const downstream = new RhythmRouter().get("/api/users", (ctx) => {
  ctx.response.body = "users";
});

const serve = (pattern: string, body = (request: Request) => new URL(request.url).pathname) =>
  toFetchHandler(
    new Rhythm()
      .use(
        mount(
          fromFetch((request) => new Response(`hit:${body(request)}`)),
          pathIs(pattern),
        ),
      )
      .use(mount(downstream)),
  );

const get = (handler: (request: Request) => Promise<Response>, path: string, init?: RequestInit) =>
  handler(new Request(`http://localhost${path}`, init));

describe("pathIs: rou3 path conventions", () => {
  const catchAll = serve("/api/auth/**");

  test("** is the catch-all: everything beneath the prefix, at any depth", async () => {
    expect(await (await get(catchAll, "/api/auth/sign-in")).text()).toBe("hit:/api/auth/sign-in");
    expect(await (await get(catchAll, "/api/auth/sign-up/email")).text()).toBe("hit:/api/auth/sign-up/email");
  });

  test("** also matches the prefix itself, with or without a trailing slash", async () => {
    expect(await (await get(catchAll, "/api/auth")).text()).toBe("hit:/api/auth");
    expect(await (await get(catchAll, "/api/auth/")).text()).toBe("hit:/api/auth/");
  });

  test("a sibling that merely starts with the prefix does not match", async () => {
    expect(await (await get(catchAll, "/api/authx")).text()).toBe("Not Found");
  });

  test("other requests pass through to the rest of the app", async () => {
    expect(await (await get(catchAll, "/api/users")).text()).toBe("users");
  });

  test("a static path matches that path only", async () => {
    const exact = serve("/api/ping");
    expect(await (await get(exact, "/api/ping")).text()).toBe("hit:/api/ping");
    expect(await (await get(exact, "/api/ping/more")).text()).toBe("Not Found");
  });

  test(":name matches exactly one segment", async () => {
    const one = serve("/api/:id/info");
    expect(await (await get(one, "/api/7/info")).text()).toBe("hit:/api/7/info");
    expect(await (await get(one, "/api/7/deep/info")).text()).toBe("Not Found");
  });

  test(":name matches one segment, and can be followed by a catch-all", async () => {
    const named = serve("/hooks/:id/**");
    expect(await (await get(named, "/hooks/7/deliver/now")).text()).toBe("hit:/hooks/7/deliver/now");
    expect(await (await get(named, "/other/7")).text()).toBe("Not Found");
  });

  test("the method is not part of the match", async () => {
    const handler = serve("/api/auth/**", (request) => request.method);
    expect(await (await get(handler, "/api/auth/sign-in", { method: "POST" })).text()).toBe("hit:POST");
    expect(await (await get(handler, "/api/auth/session", { method: "DELETE" })).text()).toBe("hit:DELETE");
  });

  test("rejects a path that does not start with a slash", () => {
    expect(() => pathIs("api/auth/**")).toThrow(TypeError);
  });
});
