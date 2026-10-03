import { addRoute, createRouter, findRoute, type RouterContext } from "rou3";
import type { HttpMethod } from "./rhythm-router";
import { mountedRoutes, RhythmRouter } from "./rhythm-router";

export type RoutePattern = string | readonly string[];

export interface RouteMatchOptions {
  include?: RoutePattern;
  exclude?: RoutePattern;
  methods?: readonly HttpMethod[];
}

export type RequestPredicate = (ctx: { readonly request: Request }) => boolean;

const toList = (pattern: RoutePattern | undefined): readonly string[] =>
  pattern === undefined ? [] : typeof pattern === "string" ? [pattern] : pattern;

const pathnameOf = (request: Request): string => new URL(request.url).pathname;

function treeOf(patterns: readonly string[], methods: readonly HttpMethod[] | undefined): RouterContext<true> {
  const tree = createRouter<true>();
  for (const pattern of patterns) {
    if (methods && methods.length > 0) for (const method of methods) addRoute(tree, method, pattern, true);
    else addRoute(tree, undefined, pattern, true);
  }
  return tree;
}

export function matches(spec: RoutePattern | RouteMatchOptions): RequestPredicate {
  const options: RouteMatchOptions =
    typeof spec === "string" || Array.isArray(spec) ? { include: spec as RoutePattern } : (spec as RouteMatchOptions);
  const include = toList(options.include);
  const includeTree = include.length > 0 ? treeOf(include, options.methods) : undefined;
  const excludeTree = toList(options.exclude).length > 0 ? treeOf(toList(options.exclude), options.methods) : undefined;
  const methodsOnly =
    !includeTree && options.methods && options.methods.length > 0 ? new Set(options.methods) : undefined;

  return ({ request }) => {
    const path = pathnameOf(request);
    if (excludeTree && findRoute(excludeTree, request.method, path, { params: false })) return false;
    if (includeTree) return !!findRoute(includeTree, request.method, path, { params: false });
    return methodsOnly ? methodsOnly.has(request.method as HttpMethod) : true;
  };
}

export function routed(module: { readonly sources: readonly object[] }): RequestPredicate {
  let tree: RouterContext<true> | undefined;
  return ({ request }) => {
    if (!tree) {
      tree = createRouter<true>();
      const seen = new Set<object>();
      for (const source of module.sources) if (source instanceof RhythmRouter) mountedRoutes(source, tree, seen);
    }
    return !!findRoute(tree, request.method, pathnameOf(request), { params: false });
  };
}
