import { Rhythm } from "./core/rhythm";

interface RequestInput {
  requestId: string;
  userId: string;
}

interface User {
  id: string;
  name: string;
}

// Sealed: pure side effect, nothing crosses back to the parent.
const auditModule = new Rhythm<{ requestId: string }>("audit").use(async (ctx, next) => {
  console.log(`[audit] request ${ctx.requestId} received`);
  await next({ auditedAt: Date.now() });
});

// Plain factory function closing over "private" state and returning an
// object exposing only methods - no class, nothing for DeepReadonly's
// mapped type to trip over when this flows through .provide()'s deps.
function createUserDb(secret: string) {
  console.log(`[auth] connecting to user database (secret: ${secret})`);
  const users: Record<string, User> = {
    u1: { id: "u1", name: "Alice" },
    u2: { id: "u2", name: "Bob" },
  };
  return {
    findUser(id: string) {
      return users[id];
    },
    close() {
      console.log("[auth] closing user database connection");
    },
  };
}

// Dynamic module: a function wrapping the Rhythm build, parameterized at
// the registration site. Building it does no work - .provide()'s factory
// only runs later, at setup()/first run(), so calling forRoot() here is safe
// even before the app's real config is ready.
const AuthModule = {
  forRoot(options: { secret: string }) {
    return new Rhythm<{ userId: string }>("auth")
      .provide(
        () => ({ db: createUserDb(options.secret) }),
        (value) => value.db.close(),
      )
      .use<{ user: User }>(async (ctx, next) => {
        await next({ user: ctx.db.findUser(ctx.userId) });
      });
  },
};

console.log("building authModule via forRoot()");
const authModule = AuthModule.forRoot({ secret: "prod-secret" });
console.log("authModule built - db not connected yet");

const app = new Rhythm<RequestInput>()
  .provide(() => ({ config: { serviceName: "greeter" } }))
  .provide((deps) => ({
    logger: { info: (msg: string) => console.log(`[${deps.config.serviceName}] ${msg}`) },
  }))
  .register(auditModule)
  .register(authModule, (result) => ({ user: result.user }))
  .use((ctx) => {
    ctx.logger.info(`request ${ctx.requestId}: hello ${ctx.user.name}`);
  });

try {
  await app.run({ requestId: "req-1", userId: "u1" });
  await app.run({ requestId: "req-2", userId: "u2" });
} finally {
  await app.teardown();
}
