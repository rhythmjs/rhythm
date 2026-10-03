import { derive, Rhythm } from "@rhythmjs/rhythm";
import type { RhythmHttpContext } from "@rhythmjs/router/context";
import type { Database } from "../database";
import { usersController } from "./users.controller";
import { createUsersService } from "./users.service";

export type UsersModuleInput = RhythmHttpContext & { db: Database };

export const usersModule = new Rhythm<UsersModuleInput>({ name: "users", type: "module" })
  .use(derive(({ db }: UsersModuleInput) => ({ usersService: createUsersService(db) })))
  .use(usersController.middleware());
