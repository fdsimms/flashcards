import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { isInDeck } from '../core/deckTree';
import { Refusal } from '../core/failure';
import type { Repo } from '../db/repo';
import { exportTsv } from '../import/exportTsv';

/**
 * Shares a deck's notes, and its subdecks', as Anki text files through the share sheet, one file per
 * note type (src/import/exportTsv.ts). Written to the caches folder, which iOS clears. Returns how
 * many notes were shared; the share sheet is the person's to dismiss, so a file they back out of
 * still counts. Throws a `Refusal` when there's nothing to share or the share sheet isn't there.
 */
export async function shareDeckNotes(repo: Repo, deck: string): Promise<number> {
  const [all, noteTypes] = await Promise.all([repo.listNotes(), repo.listNoteTypes()]);
  const notes = all.filter((n) => isInDeck(n.deck, deck));
  if (!notes.length) throw new Refusal(`"${deck}" has no notes to export.`);
  if (!(await Sharing.isAvailableAsync())) throw new Refusal("Couldn't open the share sheet on this device, so nothing was exported.");
  for (const f of exportTsv(notes, noteTypes, deck.replace(/::/g, ' - '))) {
    const file = new File(Paths.cache, f.name);
    file.create({ overwrite: true });
    await file.write(f.text);
    await Sharing.shareAsync(file.uri, { UTI: 'public.plain-text', mimeType: 'text/plain', dialogTitle: `Export ${f.name}` });
  }
  return notes.length;
}
