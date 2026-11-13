import { File, Paths } from 'expo-file-system';
import { dayKeyOf } from '../core/day';
import { Refusal } from '../core/failure';
import type { Repo } from '../db/repo';
import type { AnkiLink } from '../db/ankiLink';
import { importAnkiJson } from '../import/ankiJson';
import { reconcileIds } from '../import/reconcile';
import { clearMedia, listMedia, moveIntoMedia } from '../media/mediaFiles';
import { buildExport } from './collection';
import { fileSink, fileSource, workFolder } from './files';
import { readPackage, writePackage } from './package';
import { LATEST_VERSION } from './packageFormat';

/**
 * Moving a whole collection between Anki and Franki, by file. In: AnkiMobile's "Export" makes
 * a collection package (.colpkg), which Franki takes in whole and keeps. Out: "Send to Anki"
 * packs that kept collection, with every answer given in Franki written into it, for AnkiMobile
 * to import. One app holds the collection at a time; whatever is imported replaces the other's.
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
  const result = reconcileIds(importAnkiJson(data), await repo.listNotes());
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
  if (!kept) throw new PackageRefused("There's no Anki collection in Franki yet. Import one from AnkiMobile first.");
  const out = new File(Paths.cache, `Franki to Anki ${dayKeyOf(now)}.colpkg`);
  if (out.exists) out.delete();
  await writePackage(
    fileSink(out),
    async () => fileSource(kept),
    listMedia().map((f) => ({ name: f.name, open: async () => fileSource(f) })),
  );
  return out;
}
