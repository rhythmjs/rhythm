import { describe, expect, test } from "vite-plus/test";
import { createNode, insertRoute, joinPath, lookupRoute } from "./radix-tree";

type Method = "GET" | "POST";

function noopHandlers(): (() => void)[] {
  return [() => {}];
}

describe("insertRoute()/lookupRoute()", () => {
  test("matches an exact static path", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/users", noopHandlers());

    expect(lookupRoute(tree, "GET", "/users")).not.toBeNull();
    expect(lookupRoute(tree, "GET", "/other")).toBeNull();
  });

  test("captures a param segment", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/users/:id", noopHandlers());

    expect(lookupRoute(tree, "GET", "/users/42")?.params).toEqual({ id: "42" });
  });

  test("decodes percent-encoded param values", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/search/:term", noopHandlers());

    expect(lookupRoute(tree, "GET", "/search/hello%20world")?.params).toEqual({ term: "hello world" });
  });

  test("a static sibling always wins over a param sibling, regardless of insertion order", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/users/:id", noopHandlers());
    insertRoute(tree, "GET", "/users/active", noopHandlers());

    expect(lookupRoute(tree, "GET", "/users/active")?.params).toEqual({});
    expect(lookupRoute(tree, "GET", "/users/42")?.params).toEqual({ id: "42" });
  });

  test("static-over-param priority holds the other way around too", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/users/active", noopHandlers());
    insertRoute(tree, "GET", "/users/:id", noopHandlers());

    expect(lookupRoute(tree, "GET", "/users/active")?.params).toEqual({});
    expect(lookupRoute(tree, "GET", "/users/7")?.params).toEqual({ id: "7" });
  });

  test("splits an existing node when a later route shares only a partial prefix", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/item0", noopHandlers());
    insertRoute(tree, "GET", "/item1", noopHandlers());

    expect(lookupRoute(tree, "GET", "/item0")).not.toBeNull();
    expect(lookupRoute(tree, "GET", "/item1")).not.toBeNull();
    expect(lookupRoute(tree, "GET", "/item2")).toBeNull();
  });

  test("a route that is a prefix of another still matches on its own", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/api", noopHandlers());
    insertRoute(tree, "GET", "/api/users", noopHandlers());

    expect(lookupRoute(tree, "GET", "/api")).not.toBeNull();
    expect(lookupRoute(tree, "GET", "/api/users")).not.toBeNull();
    expect(lookupRoute(tree, "GET", "/api/other")).toBeNull();
  });

  test("distinguishes methods registered on the same path", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/users", noopHandlers());

    expect(lookupRoute(tree, "GET", "/users")).not.toBeNull();
    expect(lookupRoute(tree, "POST", "/users")).toBeNull();
  });

  test("multiple methods on the same path share one node", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/users", noopHandlers());
    insertRoute(tree, "POST", "/users", noopHandlers());

    expect(lookupRoute(tree, "GET", "/users")).not.toBeNull();
    expect(lookupRoute(tree, "POST", "/users")).not.toBeNull();
  });

  test("no match when the path is an incomplete prefix of a registered route", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/users/:id", noopHandlers());

    expect(lookupRoute(tree, "GET", "/users")).toBeNull();
  });

  test("no match for a trailing slash with nothing to capture", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/users/:id", noopHandlers());

    expect(lookupRoute(tree, "GET", "/users/")).toBeNull();
  });

  test("nested params across multiple segments", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/users/:id/posts/:postId", noopHandlers());

    expect(lookupRoute(tree, "GET", "/users/1/posts/2")?.params).toEqual({ id: "1", postId: "2" });
  });
});

describe("joinPath()", () => {
  test("returns the path unchanged when there is no prefix", () => {
    expect(joinPath("", "/users")).toBe("/users");
  });

  test("joins a prefix and a path", () => {
    expect(joinPath("/api", "/users")).toBe("/api/users");
  });

  test("trims a trailing slash on the prefix", () => {
    expect(joinPath("/api/", "/users")).toBe("/api/users");
  });

  test("adds a leading slash to the path if missing", () => {
    expect(joinPath("/api", "users")).toBe("/api/users");
  });
});
