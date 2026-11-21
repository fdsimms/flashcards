import { File, Paths } from 'expo-file-system';
import { dayKeyOf } from '../core/day';
import { Refusal } from '../core/failure';
import type { Repo } from '../db/repo';
import type { AnkiLink } from '../db/ankiLink';
import { importAnkiJson } from '../import/ankiJson';
import { reconcileIds } from '../import/reconcile';
import { clearMedia, hasMedia, listMedia, moveIntoMedia, readMedia } from '../media/mediaFiles';
import { mergeDeckPackage, packageMediaPlan, planDeckPackage, type DeckPackagePlan, type PackageMediaFile } from './apkgMerge';
import { buildExport } from './collection';
import { fileSink, fileSource, pathOf, workFolder } from './files';
import { sha1Hex } from './sha1';
import { NO_COLLECTION } from './noteService';
import { readPackage, writePackage } from './package';
import { LATEST_VERSION } from './packageFormat';

/**
 * Moving a whole collection between Anki and Franki, by file. In: AnkiMobile's "Export" makes
 * a collection package (.colpkg), which Franki takes in whole and keeps. Out: "Send to Anki"
 * packs that kept collection, with every answer given in Franki written into it, for AnkiMobile
 * to import. One app holds the collection at a time; whatever is imported replaces the other's.
 *
 * A deck package (.apkg) is the exception: it's merged into the kept collection rather than
 * replacing it (`apkgMerge.ts`), so what it adds syncs and goes back to Anki like any note added
 * in Franki.
 */

/** A package that can't be taken in, with what to do about it. */
export class PackageRefused extends Refusal {}

export interface ImportSummary {
  notes: number;
  cards: number;
  media: number;
  warnings: string[];
}

export async function importCollectionPackage(repo: Repo & AnkiLink, picked: File): Promise<ImportSummary> {
  const work = workFolder('anki-import');
  const mediaDir = workFolder('anki-import-media');
  try {
    const collection = new File(work, 'collection.anki2');
    const unpacked = await readPackage(fileSource(picked), {
      collection: async () => fileSink(collection),
      media: async (i) => fileSink(new File(mediaDir, i)),
    });
    if (!unpacked.hasCollection) {
      throw new PackageRefused(unpacked.version > 0 && unpacked.version < LATEST_VERSION
        ? 'It was exported with "Support older Anki versions" turned on. Export it again from Anki with that turned off.'
        : "It isn't an Anki collection package. In AnkiMobile, use Export and choose Collection (.colpkg).");
    }

    const result = await takeInCollection(repo, collection);

    // The package holds every media file the collection has: it replaces what's here.
    clearMedia();
    for (let i = 0; i < unpacked.mediaNames.length; i++) {
      const f = new File(mediaDir, String(i));
      if (f.exists && unpacked.mediaNames[i]) await moveIntoMedia(f, unpacked.mediaNames[i]);
    }
    await repo.keepAnkiCollection(collection);
    return { notes: result.notes.length, cards: result.cards.length, media: unpacked.mediaNames.length, warnings: result.warnings };
  } finally {
    if (work.exists) work.delete();
    if (mediaDir.exists) mediaDir.delete();
  }
}

/**
 * Makes Franki's decks match a collection file: its notes, cards with their scheduling, note
 * types and deck settings. Anki's scheduling wins for every card that came from Anki, as
 * `applyAnkiCollection` says. Used for an imported package and after a sync changed the kept one.
 */
async function takeInCollection(repo: Repo & AnkiLink, collection: File) {
  const data = buildExport(await repo.readAnkiRows(collection));
  const result = reconcileIds(importAnkiJson(data), await repo.listNotes(), await repo.listCards());
  // Note types first: a card whose template is missing falls back to plain text.
  if (result.noteTypes?.length) await repo.saveNoteTypes(result.noteTypes);
  await repo.applyAnkiCollection(result.notes, result.cards);
  if (result.deckParams?.size) await repo.saveDeckParams(result.deckParams);
  if (result.collectionSettings) await repo.saveCollectionSettings(result.collectionSettings);
  return result;
}

/** After a sync changed the kept collection: Franki's decks are read from it again. */
export async function refreshFromKeptCollection(repo: Repo & AnkiLink): Promise<void> {
  const kept = await repo.keptCollection();
  if (kept) await takeInCollection(repo, kept);
}

/** A collection downloaded whole from a sync server becomes the kept one, and Franki's decks follow it. */
export async function adoptDownloadedCollection(repo: Repo & AnkiLink, downloaded: File): Promise<void> {
  await takeInCollection(repo, downloaded);
  await repo.keepAnkiCollection(downloaded);
}

/** Packs the kept collection, with Franki's answers in it, as a package for Anki to import. */
export async function buildPackageForAnki(repo: AnkiLink, now = new Date()): Promise<File> {
  const kept = await repo.keptCollection();
  if (!kept) throw new PackageRefused(NO_COLLECTION);
  const out = new File(Paths.cache, `Franki to Anki ${dayKeyOf(now)}.colpkg`);
  if (out.exists) out.delete();
  await writePackage(
    fileSink(out),
    async () => fileSource(kept),
    listMedia().map((f) => ({ name: f.name, open: async () => fileSource(f) })),
  );
  return out;
}

/** A deck package unpacked and looked over, waiting for the person to import it or not. */
export interface OpenedDeckPackage {
  plan: DeckPackagePlan;
  /** Media files it would add, and those it keeps because a different file here has the name. */
  media: { add: number; kept: string[] };
  /** Merges it into the kept collection. Call inside `lockAnki`. The work files are gone after. */
  merge(): Promise<{ plan: DeckPackagePlan; media: number; kept: string[] }>;
  /** Removes the work files without importing. */
  discard(): void;
}

/**
 * Unpacks a deck package and works out what merging it would add, writing nothing. Call inside
 * `lockAnki`. The caller merges or discards it.
 */
export async function openDeckPackage(repo: Repo & AnkiLink, picked: File): Promise<OpenedDeckPackage> {
  if (!(await repo.keptCollection())) {
    throw new PackageRefused(NO_COLLECTION);
  }
  const work = workFolder('apkg-import');
  const mediaDir = workFolder('apkg-import-media');
  const discard = () => {
    if (work.exists) work.delete();
    if (mediaDir.exists) mediaDir.delete();
  };
  try {
    const collection = new File(work, 'package.anki2');
    const unpacked = await readPackage(fileSource(picked), {
      collection: async () => fileSink(collection),
      media: async (i) => fileSink(new File(mediaDir, i)),
    });
    if (!unpacked.hasCollection) {
      // An older package (collection.anki2 or .anki21) keeps note types and decks as JSON in an
      // older schema; it's refused with what to change rather than half-read.
      throw new PackageRefused(unpacked.version > 0 && unpacked.version < LATEST_VERSION
        ? 'It was exported with "Support older Anki versions" turned on. Export it again from Anki with that turned off.'
        : "It isn't an Anki deck package. In Anki, use Export and choose Anki Deck Package (.apkg).");
    }
    const dayStartsAtHour = (await repo.collectionSettings()).dayStartsAtHour;
    const path = pathOf(collection);
    const plan = await repo.withSyncConnection((db) => planDeckPackage(db, path, { now: new Date(), dayStartsAtHour }));
    const files: PackageMediaFile[] = unpacked.mediaNames.map((name, index) => ({ index, name, sha1: unpacked.mediaSha1[index] }));
    const existing = new Map<string, string>();
    for (const f of files) {
      const bytes = f.name && hasMedia(f.name) ? await readMedia(f.name) : undefined;
      if (bytes) existing.set(f.name, sha1Hex(bytes));
    }
    const media = packageMediaPlan(files, (name) => existing.get(name));

    return {
      plan,
      media: { add: media.add.length, kept: media.kept },
      discard,
      async merge() {
        try {
          // Worked out again in the write's own transaction: the collection may have changed since the preview.
          const merged = await repo.withSyncConnection((db) => mergeDeckPackage(db, path, { now: new Date(), dayStartsAtHour }));
          const state = repo.mediaSyncState();
          let added = 0;
          for (const f of media.add) {
            const src = new File(mediaDir, String(f.index));
            // A file that turned up here since the preview (a sync's media pull) is left as it is.
            if (!src.exists || hasMedia(f.name)) continue;
            await moveIntoMedia(src, f.name);
            added++;
            // Joins the files the next media sync sends, as a recording made here does.
            if (f.sha1 && (await state.recorded(f.name)) !== f.sha1) await state.setPending(f.name, f.sha1);
          }
          if (merged.newNotes) await refreshFromKeptCollection(repo);
          return { plan: merged, media: added, kept: media.kept };
        } finally {
          discard();
        }
      },
    };
  } catch (e) {
    discard();
    throw e;
  }
}
