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

  test("backtracks into a param branch when a static branch dead-ends deeper", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/users/new", noopHandlers());
    insertRoute(tree, "GET", "/users/:id/posts", noopHandlers());

    expect(lookupRoute(tree, "GET", "/users/new")?.params).toEqual({});
    expect(lookupRoute(tree, "GET", "/users/new/posts")?.params).toEqual({ id: "new" });
  });
});

describe("wildcards", () => {
  test("captures the rest of the path under the '*' param", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/files/*", noopHandlers());

    expect(lookupRoute(tree, "GET", "/files/docs/readme.md")?.params).toEqual({ "*": "docs/readme.md" });
  });

  test("matches an empty remainder, but not the path without the trailing slash", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/files/*", noopHandlers());

    expect(lookupRoute(tree, "GET", "/files/")?.params).toEqual({ "*": "" });
    expect(lookupRoute(tree, "GET", "/files")).toBeNull();
  });

  test("static and param siblings win over the wildcard", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/files/*", noopHandlers());
    insertRoute(tree, "GET", "/files/index", noopHandlers());
    insertRoute(tree, "GET", "/files/:name", noopHandlers());

    expect(lookupRoute(tree, "GET", "/files/index")?.params).toEqual({});
    expect(lookupRoute(tree, "GET", "/files/a")?.params).toEqual({ name: "a" });
    expect(lookupRoute(tree, "GET", "/files/a/b")?.params).toEqual({ "*": "a/b" });
  });

  test("falls back to the wildcard when a static branch dead-ends deeper", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/files/img/logo.png", noopHandlers());
    insertRoute(tree, "GET", "/files/*", noopHandlers());

    expect(lookupRoute(tree, "GET", "/files/img/logo.png")?.params).toEqual({});
    expect(lookupRoute(tree, "GET", "/files/img/other.png")?.params).toEqual({ "*": "img/other.png" });
  });

  test("decodes the captured rest", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/files/*", noopHandlers());

    expect(lookupRoute(tree, "GET", "/files/hello%20world")?.params).toEqual({ "*": "hello world" });
  });

  test("is method-scoped like any other route", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/files/*", noopHandlers());

    expect(lookupRoute(tree, "POST", "/files/a")).toBeNull();
  });

  test("rejects a wildcard that is not at the end of the path", () => {
    const tree = createNode<Method>();

    expect(() => insertRoute(tree, "GET", "/files/*/meta", noopHandlers())).toThrow();
  });
});

describe("optional params", () => {
  test("matches with and without the optional segment", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/users/:id?", noopHandlers());

    expect(lookupRoute(tree, "GET", "/users")?.params).toEqual({});
    expect(lookupRoute(tree, "GET", "/users/42")?.params).toEqual({ id: "42" });
    expect(lookupRoute(tree, "GET", "/users/42/extra")).toBeNull();
  });

  test("chained optional params expand progressively", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/posts/:year?/:month?", noopHandlers());

    expect(lookupRoute(tree, "GET", "/posts")?.params).toEqual({});
    expect(lookupRoute(tree, "GET", "/posts/2024")?.params).toEqual({ year: "2024" });
    expect(lookupRoute(tree, "GET", "/posts/2024/05")?.params).toEqual({ year: "2024", month: "05" });
  });

  test("an optional param at the root matches '/'", () => {
    const tree = createNode<Method>();
    insertRoute(tree, "GET", "/:page?", noopHandlers());

    expect(lookupRoute(tree, "GET", "/")?.params).toEqual({});
    expect(lookupRoute(tree, "GET", "/about")?.params).toEqual({ page: "about" });
  });

  test("rejects a required segment after an optional param", () => {
    const tree = createNode<Method>();

    expect(() => insertRoute(tree, "GET", "/users/:id?/posts", noopHandlers())).toThrow();
    expect(() => insertRoute(tree, "GET", "/users/:id?/*", noopHandlers())).toThrow();
  });

  test("rejects '?' anywhere other than marking an optional param", () => {
    const tree = createNode<Method>();

    expect(() => insertRoute(tree, "GET", "/users?", noopHandlers())).toThrow();
    expect(() => insertRoute(tree, "GET", "/users/:id?x", noopHandlers())).toThrow();
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
