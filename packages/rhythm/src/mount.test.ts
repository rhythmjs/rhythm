import { describe, expect, test } from "bun:test";
import { decorate } from "./decorate";
import { derive } from "./derive";
import { include } from "./include";
import { mount } from "./mount";
import { Rhythm } from "./rhythm";
import { Pipeline } from "./pipeline";
import { sourceOf } from "./source";

class Leaf extends Pipeline<{}> {
  override callback() {
    return async (ctx: object) => ctx;
  }
}

const boom = () => {
  throw new Error("boom");
};

describe("source discovery", () => {
  test("mount tags its middleware with the plugin and use() adopts it", () => {
    const routes = new Leaf();
    const middleware = mount(routes);
    expect(sourceOf(middleware)).toBe(routes);

    const app = new Rhythm().use(middleware);
    expect(app.sources).toEqual([routes]);
    expect(routes.parent).toBe(app);
  });

  test("Rhythm modules are transparent: nested leaves are flattened", () => {
    const routes = new Leaf();
    const inner = new Rhythm().use(mount(routes));
    const app = new Rhythm().use(mount(inner));
    expect(app.sources).toEqual([routes]);
    expect(inner.parent).toBe(app);
    expect(routes.parent).toBe(inner);
  });

  test("include() adopts the plugin and exposes its leaves", () => {
    const routes = new Leaf();
    const child = new Rhythm().use(mount(routes, () => false));
    const app = new Rhythm().register(include(child));
    expect(sourceOf(include(child))).toBe(child);
    expect(app.sources).toEqual([routes]);
    expect(child.parent).toBe(app);
  });

  test("plain middleware contributes no sources", () => {
    const app = new Rhythm().use((_, next) => next());
    expect(app.sources).toEqual([]);
  });
});

describe("failure context", () => {
  test("mount wraps a failing plugin with its type and name", async () => {
    const child = new Rhythm({ name: "billing", type: "service" }).use(boom);
    const app = new Rhythm().use(mount(child));
    const error = await app
      .callback()()
      .catch((e) => e);
    expect(error.message).toBe('mounted service "billing" failed');
    expect(error.cause.message).toBe("boom");
  });

  test("defaults to module/anonymous", async () => {
    const app = new Rhythm().use(mount(new Rhythm().use(boom)));
    expect(
      (
        await app
          .callback()()
          .catch((e) => e)
      ).message,
    ).toBe('mounted module "anonymous" failed');
  });

  test("downstream errors are not attributed to the mounted plugin", async () => {
    const app = new Rhythm().use(mount(new Rhythm())).use(boom);
    expect(
      (
        await app
          .callback()()
          .catch((e) => e)
      ).message,
    ).toBe("boom");
  });

  test("include wraps a failing plugin startup", async () => {
    const child = new Rhythm({ name: "db" }).use(boom);
    const app = new Rhythm().register(include(child));
    const error = await app
      .callback()()
      .catch((e) => e);
    expect(error.message).toBe('included module "db" failed');
    expect(error.cause.message).toBe("boom");
  });
});

describe("typed input", () => {
  test("callback() passes input into the context", async () => {
    const app = new Rhythm<{}, { name: string }>()
      .register(decorate(() => ({ greeting: "hi" })))
      .use(derive((ctx) => ({ message: `${ctx.greeting} ${ctx.name}` })));
    const ctx = await app.callback()({ name: "ada" });
    expect(ctx.message).toBe("hi ada");
    expect(ctx.name).toBe("ada");
  });

  test("input is optional when none is required and required otherwise", () => {
    const optional = new Rhythm();
    const required = new Rhythm<{}, { name: string }>();
    void optional.callback()();
    void required.callback()({ name: "x" });
    // @ts-expect-error input is required
    void required.callback()();
    // @ts-expect-error wrong input type
    void required.callback()({ name: 1 });
  });

  test("mount/include reject a parent that cannot supply the input", () => {
    const needsName = new Rhythm<{}, { name: string }>();
    const ok = new Rhythm<{ name: string }>();
    ok.use(mount(needsName));
    ok.register(include(needsName));
    const bare = new Rhythm();
    // @ts-expect-error parent context lacks `name`
    bare.use(mount(needsName));
    // @ts-expect-error parent context lacks `name`
    bare.register(include(needsName));
  });

  test("decorate still extends the context", async () => {
    const app = new Rhythm().register(decorate(() => ({ x: 1 })));
    expect((await app.callback()()).x).toBe(1);
  });
});

test("decorate() awaits an async factory before the first call", async () => {
  const app = new Rhythm().register(decorate(async () => ({ db: "ready" })));
  expect((await app.callback()()).db).toBe("ready");
});
