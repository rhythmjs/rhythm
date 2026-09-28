import { compose, type Middleware, type NextFn } from "../core/rhythm";

type RouteDispatch = (context: any, next?: NextFn<any>) => Promise<any>;

export type MethodEntry = {
  handlers: Middleware<any>[];
  dispatch: RouteDispatch;
};

export class TreeNode<TMethod extends string = string> {
  path = "";
  indices = "";
  children: TreeNode<TMethod>[] = [];
  paramChild: TreeNode<TMethod> | null = null;
  paramName = "";
  methods: Map<TMethod, MethodEntry> | null = null;
}

export function createNode<TMethod extends string = string>(): TreeNode<TMethod> {
  return new TreeNode<TMethod>();
}

function commonPrefixLength(a: string, b: string): number {
  const max = a.length < b.length ? a.length : b.length;
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function splitChild<TMethod extends string>(node: TreeNode<TMethod>, at: number): void {
  const tail = new TreeNode<TMethod>();
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

function insertAt<TMethod extends string>(
  node: TreeNode<TMethod>,
  path: string,
  method: TMethod,
  handlers: Middleware<any>[],
): void {
  if (path.length === 0) {
    if (!node.methods) node.methods = new Map();
    node.methods.set(method, { handlers, dispatch: compose(handlers) });
    return;
  }

  if (path.charCodeAt(0) === 58 /* ":" */) {
    const slashIndex = path.indexOf("/");
    const name = slashIndex === -1 ? path.slice(1) : path.slice(1, slashIndex);
    const rest = slashIndex === -1 ? "" : path.slice(slashIndex);
    if (!node.paramChild) {
      node.paramChild = new TreeNode<TMethod>();
      node.paramChild.paramName = name;
    }
    insertAt(node.paramChild, rest, method, handlers);
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
    insertAt(child, path.slice(cpl), method, handlers);
    return;
  }

  const child = new TreeNode<TMethod>();
  child.path = staticPart;
  node.children.push(child);
  node.indices += firstChar;
  insertAt(child, path.slice(staticPart.length), method, handlers);
}

export function insertRoute<TMethod extends string>(
  root: TreeNode<TMethod>,
  method: TMethod,
  path: string,
  handlers: Middleware<any>[],
): void {
  insertAt(root, path, method, handlers);
}

export function lookupRoute<TMethod extends string>(
  root: TreeNode<TMethod>,
  method: string,
  pathname: string,
): { entry: MethodEntry; params: Record<string, string> } | null {
  const params: Record<string, string> = {};
  let node = root;
  let path = pathname;

  while (path.length > 0) {
    const firstChar = path.charAt(0);
    let matched: TreeNode<TMethod> | null = null;

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
  const entry = node.methods.get(method as TMethod);
  if (!entry) return null;
  return { entry, params };
}

export function joinPath(prefix: string, path: string): string {
  if (!prefix) return path;
  const trimmedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedPrefix}${normalizedPath}`;
}
