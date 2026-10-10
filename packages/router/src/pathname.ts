// Anything the WHATWG URL parser would rewrite in a path: backslashes, dot
// segments (also percent-encoded), whitespace/control/non-ASCII and the characters
// it percent-encodes. Such URLs take the slow, spec-exact route.
const NEEDS_PARSING = /[\\\u0000- \u007f-￿"<>^`{|}]|\/\.|%2e/i;

export function pathnameOf(url: string): string {
  const authority = url.indexOf("://") + 3;
  const start = url.indexOf("/", authority);
  if (authority < 3 || start === -1) return new URL(url).pathname;

  let end = url.length;
  const query = url.indexOf("?", start);
  if (query !== -1) end = query;
  const hash = url.indexOf("#", start);
  if (hash !== -1 && hash < end) end = hash;

  const pathname = url.slice(start, end);
  return NEEDS_PARSING.test(pathname) ? new URL(url).pathname : pathname;
}
