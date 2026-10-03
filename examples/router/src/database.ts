import type { Note } from "./notes/notes.service";
import type { User } from "./users/users.service";

export interface Database {
  users: Map<string, User>;
  notes: Map<string, Note>;
}

export function createDatabase(): Database {
  return {
    users: new Map([
      ["u1", { id: "u1", name: "Alice" }],
      ["u2", { id: "u2", name: "Bob" }],
    ]),
    notes: new Map([["n1", { id: "n1", userId: "u1", text: "Hello from Alice" }]]),
  };
}
