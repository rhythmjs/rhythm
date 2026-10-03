import { derive, Rhythm } from "@rhythmjs/rhythm";
import type { RhythmHttpContext } from "@rhythmjs/router/context";
import type { Database } from "../database";
import { notesController } from "./notes.controller";
import { createNotesService } from "./notes.service";

export type NotesModuleInput = RhythmHttpContext & { db: Database };

export const notesModule = new Rhythm<NotesModuleInput>({ name: "notes", type: "module" })
  .use(derive(({ db }: NotesModuleInput) => ({ notesService: createNotesService(db) })))
  .use(notesController.middleware());
