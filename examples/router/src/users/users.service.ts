import type { Database } from "../database";

export interface User {
  id: string;
  name: string;
}

export function createUsersService(db: Database) {
  return {
    list: (): User[] => [...db.users.values()],
    get: (id: string): User | undefined => db.users.get(id),
    create(name: string): User {
      const user = { id: `u${crypto.randomUUID().slice(0, 8)}`, name };
      db.users.set(user.id, user);
      return user;
    },
    update(id: string, name: string): User | undefined {
      const user = db.users.get(id);
      if (user) user.name = name;
      return user;
    },
    remove: (id: string): boolean => db.users.delete(id),
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
