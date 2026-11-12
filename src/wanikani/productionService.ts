import { NoteRefused, saveNote, type NoteStore } from '../anki/noteService';
import { sha1Hex } from '../anki/sha1';
import type { WaniKaniApi } from './api';
import { audioFileName, audioFor, NOTE_TYPE, productionFields, productionNeeded, productionTags } from './production';

/**
 * Making production notes (production.ts) for words that reached Guru: the word's subject read
 * from WaniKani, its recording kept in the media folder and put on the list the next sync sends,
 * and the note saved the way the note editor saves one (`saveNote`), so it reaches Anki.
 */

/** Notes made at most per run, so the first run on a big account doesn't hold the collection for long. */
export const PRODUCTION_BATCH = 50;

export interface ProductionDeps {
  store: NoteStore;
  api: Pick<WaniKaniApi, 'passedVocabulary' | 'subjects' | 'download'>;
  media: {
    exists(name: string): boolean;
    read(name: string): Promise<Uint8Array | undefined>;
    write(name: string, bytes: Uint8Array): Promise<void>;
    recorded(name: string): Promise<string | undefined>;
    setPending(name: string, sha1: string): Promise<void>;
  };
}

export interface ProductionResult {
  /** Subject ids given a note this run (or found to have nothing to make), to remember. */
  made: number[];
  /** Words still waiting after this run's batch. */
  waiting: number;
  /** Why notes couldn't be made at all (the deck isn't there), to show in WaniKani's settings. */
  refused?: string;
}

export async function makeProductionNotes(
  deps: ProductionDeps,
  opts: { deck: string; maxLevel: number; made: ReadonlySet<number>; now?: Date },
): Promise<ProductionResult> {
  const passed = await deps.api.passedVocabulary(opts.maxLevel);
  const notes = await deps.store.listNotes();
  const all = productionNeeded(passed, notes, opts.made, Number.MAX_SAFE_INTEGER);
  const batch = all.slice(0, PRODUCTION_BATCH);
  if (!batch.length) return { made: [], waiting: 0 };
  const subjects = new Map((await deps.api.subjects(batch.map((a) => a.subjectId))).map((s) => [s.id, s]));
  const made: number[] = [];
  for (const a of batch) {
    const subject = subjects.get(a.subjectId);
    // Hidden by WaniKani, or with nothing to write: remembered, so it isn't asked for again.
    if (!subject || subject.hidden || !subject.characters) {
      made.push(a.subjectId);
      continue;
    }
    let audioFile: string | undefined;
    let sha1: string | undefined;
    const audio = audioFor(subject);
    if (audio) {
      const name = audioFileName(subject.id, audio);
      try {
        let bytes = deps.media.exists(name) ? await deps.media.read(name) : undefined;
        if (!bytes?.length) {
          bytes = await deps.api.download(audio.url);
          await deps.media.write(name, bytes);
        }
        audioFile = name;
        sha1 = sha1Hex(bytes);
      } catch {
        // No recording this time: the card falls back to the phone's voice.
      }
    }
    try {
      await saveNote(deps.store, { deck: opts.deck, model: NOTE_TYPE, fields: productionFields(subject, audioFile), tags: productionTags(subject.id) }, opts.now);
    } catch (e) {
      if (e instanceof NoteRefused) return { made, waiting: all.length - made.length, refused: e.message };
      throw e;
    }
    if (audioFile && sha1 && (await deps.media.recorded(audioFile)) !== sha1) await deps.media.setPending(audioFile, sha1);
    made.push(subject.id);
  }
  return { made, waiting: all.length - made.length };
}
