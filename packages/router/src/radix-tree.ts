export class TreeNode<TMethod extends string = string, TPayload = unknown> {
  path = "";
  indices = "";
  children: TreeNode<TMethod, TPayload>[] = [];
  paramChild: TreeNode<TMethod, TPayload> | null = null;
  paramName = "";
  wildcardChild: TreeNode<TMethod, TPayload> | null = null;
  methods: Map<TMethod, TPayload> | null = null;
}

export function createNode<TMethod extends string = string, TPayload = unknown>(): TreeNode<TMethod, TPayload> {
  return new TreeNode<TMethod, TPayload>();
}

function commonPrefixLength(a: string, b: string): number {
  const max = a.length < b.length ? a.length : b.length;
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function splitChild<TMethod extends string, TPayload>(node: TreeNode<TMethod, TPayload>, at: number): void {
  const tail = new TreeNode<TMethod, TPayload>();
  tail.path = node.path.slice(at);
  tail.indices = node.indices;
  tail.children = node.children;
  tail.paramChild = node.paramChild;
  tail.paramName = node.paramName;
  tail.wildcardChild = node.wildcardChild;
  tail.methods = node.methods;

  node.path = node.path.slice(0, at);
  node.children = [tail];
  node.indices = tail.path.charAt(0);
  node.paramChild = null;
  node.paramName = "";
  node.wildcardChild = null;
  node.methods = null;
}

function insertAt<TMethod extends string, TPayload>(
  node: TreeNode<TMethod, TPayload>,
  path: string,
  method: TMethod,
  payload: TPayload,
): void {
  if (path.length === 0) {
    if (!node.methods) node.methods = new Map();
    node.methods.set(method, payload);
    return;
  }

  if (path.charCodeAt(0) === 58) {
    const slashIndex = path.indexOf("/");
    const name = slashIndex === -1 ? path.slice(1) : path.slice(1, slashIndex);
    const rest = slashIndex === -1 ? "" : path.slice(slashIndex);
    if (!node.paramChild) {
      node.paramChild = new TreeNode<TMethod, TPayload>();
      node.paramChild.paramName = name;
    }
    insertAt(node.paramChild, rest, method, payload);
    return;
  }

  if (path.charCodeAt(0) === 42) {
    if (path.length !== 1) throw new Error('wildcard "*" is only allowed at the end of a path');
    if (!node.wildcardChild) node.wildcardChild = new TreeNode<TMethod, TPayload>();
    if (!node.wildcardChild.methods) node.wildcardChild.methods = new Map();
    node.wildcardChild.methods.set(method, payload);
    return;
  }

  const colonIndex = path.indexOf(":");
  const starIndex = path.indexOf("*");
  let staticEnd = path.length;
  if (colonIndex !== -1) staticEnd = colonIndex;
  if (starIndex !== -1 && starIndex < staticEnd) staticEnd = starIndex;
  const staticPart = path.slice(0, staticEnd);
  const firstChar = path.charAt(0);

  for (let i = 0; i < node.children.length; i++) {
    if (node.indices.charAt(i) !== firstChar) continue;
    const child = node.children[i]!;
    const cpl = commonPrefixLength(staticPart, child.path);
    if (cpl === 0) continue;
    if (cpl < child.path.length) splitChild(child, cpl);
    insertAt(child, path.slice(cpl), method, payload);
    return;
  }

  const child = new TreeNode<TMethod, TPayload>();
  child.path = staticPart;
  node.children.push(child);
  node.indices += firstChar;
  insertAt(child, path.slice(staticPart.length), method, payload);
}

// "/users/:id?" registers both "/users" and "/users/:id"; optional params may
// only be followed by other optional params, so every expansion is a valid path.
function expandOptionalParams(path: string): string[] {
  if (!path.includes("?")) return [path];

  const segments = path.split("/");
  let firstOptional = -1;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const isOptional = segment.length > 2 && segment.charCodeAt(0) === 58 && segment.endsWith("?");
    if (!isOptional && segment.includes("?")) {
      throw new Error(`"?" is only allowed to mark an optional param like ":name?" (in "${path}")`);
    }
    if (firstOptional !== -1 && !isOptional) {
      throw new Error(`only optional params may follow an optional param (in "${path}")`);
    }
    if (isOptional && firstOptional === -1) firstOptional = i;
  }

  const variants: string[] = [];
  for (let end = firstOptional; end <= segments.length; end++) {
    const parts = segments.slice(0, end).map((segment) => (segment.endsWith("?") ? segment.slice(0, -1) : segment));
    variants.push(parts.join("/") || "/");
  }
  return variants;
}

export function insertRoute<TMethod extends string, TPayload>(
  root: TreeNode<TMethod, TPayload>,
  method: TMethod,
  path: string,
  payload: TPayload,
): void {
  for (const variant of expandOptionalParams(path)) {
    insertAt(root, variant, method, payload);
  }
}

function search<TMethod extends string, TPayload>(
  node: TreeNode<TMethod, TPayload>,
  method: TMethod,
  path: string,
): { payload: TPayload; params: Record<string, string> } | null {
  if (path.length === 0) {
    const payload = node.methods?.get(method);
    if (payload !== undefined) return { payload, params: {} };
  } else {
    const firstChar = path.charAt(0);
    for (let i = 0; i < node.children.length; i++) {
      if (node.indices.charAt(i) !== firstChar) continue;
      const child = node.children[i]!;
      if (!path.startsWith(child.path)) continue;
      const result = search(child, method, path.slice(child.path.length));
      if (result) return result;
    }

    if (node.paramChild) {
      const slashIndex = path.indexOf("/");
      const value = slashIndex === -1 ? path : path.slice(0, slashIndex);
      if (value.length > 0) {
        const rest = slashIndex === -1 ? "" : path.slice(slashIndex);
        const result = search(node.paramChild, method, rest);
        if (result) {
          result.params[node.paramChild.paramName] = decodeURIComponent(value);
          return result;
        }
      }
    }
  }

  // The wildcard also matches an empty remainder, so "/files/*" serves "/files/".
  if (node.wildcardChild) {
    const payload = node.wildcardChild.methods?.get(method);
    if (payload !== undefined) {
      return { payload, params: { "*": decodeURIComponent(path) } };
    }
  }

  return null;
}

export function lookupRoute<TMethod extends string, TPayload>(
  root: TreeNode<TMethod, TPayload>,
  method: string,
  pathname: string,
): { payload: TPayload; params: Record<string, string> } | null {
  return search(root, method as TMethod, pathname);
}

export function joinPath(prefix: string, path: string): string {
  if (!prefix) return path;
  const trimmedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedPrefix}${normalizedPath}`;
}
