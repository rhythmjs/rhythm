export { pathnameOf } from "./pathname";

const NEEDS_DECODING = /[%+\u0000-\u001f]/;

export function searchParam(url: string, name: string): string | null {
  const start = url.indexOf("?");
  const hash = url.indexOf("#");
  if (start === -1 || (hash !== -1 && hash < start)) return null;

  const end = hash === -1 ? url.length : hash;

  const query = url.slice(start + 1, end);
  if (NEEDS_DECODING.test(query) || NEEDS_DECODING.test(name)) return new URL(url).searchParams.get(name);

  let from = 0;
  while (from <= query.length) {
    let amp = query.indexOf("&", from);
    if (amp === -1) amp = query.length;
    if (amp > from) {
      const eq = query.indexOf("=", from);
      const keyEnd = eq === -1 || eq > amp ? amp : eq;
      if (keyEnd - from === name.length && query.startsWith(name, from))
        return eq === -1 || eq > amp ? "" : query.slice(eq + 1, amp);
    }
    from = amp + 1;
  }
  return null;
}
