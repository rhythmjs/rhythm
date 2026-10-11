import { describe, expect, test } from "bun:test";
import { pathnameOf, searchParam } from "./url";

describe("searchParam", () => {
  const cases: [string, string, string | null][] = [
    ["http://h/p?name=bun", "name", "bun"],
    ["http://h/p?a=1&name=bun&b=2", "name", "bun"],
    ["http://h/p?name=bun&name=deno", "name", "bun"],
    ["http://h/p?name", "name", ""],
    ["http://h/p?name=", "name", ""],
    ["http://h/p?a=1&name&b=2", "name", ""],
    ["http://h/p?&&name=x&&", "name", "x"],
    ["http://h/p?username=x", "name", null],
    ["http://h/p?names=x", "name", null],
    ["http://h/p?nam=x", "name", null],
    ["http://h/p?a=name=x", "name", null],
    ["http://h/p?name=a=b", "name", "a=b"],
    ["http://h/p", "name", null],
    ["http://h/p?", "name", null],
    ["http://h/p?name=bun#frag", "name", "bun"],
    ["http://h/p#frag?name=bun", "name", null],
    ["http://h/p?name=a%20b", "name", "a b"],
    ["http://h/p?name=a+b", "name", "a b"],
    ["http://h/p?na%6De=x", "name", "x"],
    ["http://h/p?name=%E2%9C%93", "name", "✓"],
    ["http://h/p?name=é", "name", "é"],
    ["http://h/p?x=1", "", null],
    ["http://h/p?=v", "", "v"],
  ];

  for (const [url, name, expected] of cases)
    test(`${url} -> ${name}`, () => {
      expect(searchParam(url, name)).toBe(expected);
      expect(searchParam(url, name)).toBe(new URL(url).searchParams.get(name));
    });

  test("matches URLSearchParams on random queries", () => {
    const pieces = ["name", "n", "=", "&", "a", "%20", "+", "x", "name=", "?", "ame", "%", "é", " "];
    let seed = 7;
    const next = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed);
    for (let i = 0; i < 4000; i++) {
      let query = "";
      for (let j = next() % 8; j >= 0; j--) query += pieces[next() % pieces.length];
      const url = `http://h/p?${query}`;
      for (const key of ["name", "n", "a", ""]) expect(searchParam(url, key)).toBe(new URL(url).searchParams.get(key));
    }
  });
});

describe("pathnameOf", () => {
  test("is re-exported for handlers that want a cheap path", () => {
    expect(pathnameOf("http://h/a/b?x=1")).toBe("/a/b");
  });
});
