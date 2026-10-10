import { expect, test } from "bun:test";
import { pathnameOf } from "./pathname";

const urls = [
  "http://localhost:3000/",
  "http://localhost:3000/json",
  "http://localhost:3000/users/12345?x=1&y=/z",
  "http://localhost:3000/a/b#frag",
  "http://localhost:3000/a?b#c?d",
  "http://localhost:3000/search?q=a/b",
  "https://example.com/caf%C3%A9/%2Fslash",
  "http://localhost:3000/a/../b",
  "http://localhost:3000/a/./b",
  "http://localhost:3000/a/%2e%2e/b",
  "http://localhost:3000/a/%2E/b",
  "http://localhost:3000/a\\b",
  "http://localhost:3000/a b",
  "http://localhost:3000/ünï",
  "http://localhost:3000/a|b",
  "http://localhost:3000",
  "http://localhost:3000?x=1",
  "http://user:pw@localhost:3000/x",
  "http://localhost:3000//double//slash",
];

test("pathnameOf matches new URL().pathname", () => {
  for (const url of urls) expect(pathnameOf(url)).toBe(new URL(url).pathname);
});

test("pathnameOf resolves dot segments instead of matching them literally", () => {
  expect(pathnameOf("http://localhost:3000/admin/../public")).toBe("/public");
});
