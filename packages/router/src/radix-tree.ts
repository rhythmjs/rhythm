export class TreeNode<TMethod extends string = string, TPayload = unknown> {
  path = "";
  indices = "";
  children: TreeNode<TMethod, TPayload>[] = [];
  paramChild: TreeNode<TMethod, TPayload> | null = null;
  paramName = "";
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
  tail.methods = node.methods;

  node.path = node.path.slice(0, at);
  node.children = [tail];
  node.indices = tail.path.charAt(0);
  node.paramChild = null;
  node.paramName = "";
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

  const colonIndex = path.indexOf(":");
  const staticPart = colonIndex === -1 ? path : path.slice(0, colonIndex);
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

export function insertRoute<TMethod extends string, TPayload>(
  root: TreeNode<TMethod, TPayload>,
  method: TMethod,
  path: string,
  payload: TPayload,
): void {
  insertAt(root, path, method, payload);
}

export function lookupRoute<TMethod extends string, TPayload>(
  root: TreeNode<TMethod, TPayload>,
  method: string,
  pathname: string,
): { payload: TPayload; params: Record<string, string> } | null {
  const params: Record<string, string> = {};
  let node = root;
  let path = pathname;

  while (path.length > 0) {
    const firstChar = path.charAt(0);
    let matched: TreeNode<TMethod, TPayload> | null = null;

    for (let i = 0; i < node.children.length; i++) {
      if (node.indices.charAt(i) !== firstChar) continue;
      const child = node.children[i]!;
      if (path.startsWith(child.path)) {
        matched = child;
        break;
      }
    }

    if (matched) {
      path = path.slice(matched.path.length);
      node = matched;
      continue;
    }

    if (node.paramChild) {
      const slashIndex = path.indexOf("/");
      const value = slashIndex === -1 ? path : path.slice(0, slashIndex);
      if (value.length === 0) return null;
      params[node.paramChild.paramName] = decodeURIComponent(value);
      path = slashIndex === -1 ? "" : path.slice(slashIndex);
      node = node.paramChild;
      continue;
    }

    return null;
  }

  if (!node.methods) return null;
  const payload = node.methods.get(method as TMethod);
  if (payload === undefined) return null;
  return { payload, params };
}

export function joinPath(prefix: string, path: string): string {
  if (!prefix) return path;
  const trimmedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedPrefix}${normalizedPath}`;
}
