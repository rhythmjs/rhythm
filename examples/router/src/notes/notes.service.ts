import type { Database } from "../database";

export interface Note {
  id: string;
  userId: string;
  text: string;
}

export function createNotesService(db: Database) {
  return {
    list: (userId?: string): Note[] => [...db.notes.values()].filter((note) => !userId || note.userId === userId),
    get: (id: string): Note | undefined => db.notes.get(id),
    create(userId: string, text: string): Note | undefined {
      if (!db.users.has(userId)) return undefined;
      const note = { id: `n${crypto.randomUUID().slice(0, 8)}`, userId, text };
      db.notes.set(note.id, note);
      return note;
    },
    remove: (id: string): boolean => db.notes.delete(id),
  };
}

export type NotesService = ReturnType<typeof createNotesService>;
