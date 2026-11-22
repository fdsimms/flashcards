/**
 * The pure half of selecting several rows in a list (a cram's words, Browse): which rows are picked,
 * and the words the bar and the delete question use.
 */

/** The selection with `id` picked, or put back if it was. A new set, so React sees the change. */
export function toggled(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** Only the picked rows still in the list: a row that was synced away or deleted can't stay selected. */
export function stillListed(selected: ReadonlySet<string>, ids: Iterable<string>): Set<string> {
  const here = new Set(ids);
  return new Set([...selected].filter((id) => here.has(id)));
}

/** What the bar says: "3 selected", or what to do when nothing is. */
export function selectedText(count: number): string {
  return count === 0 ? 'Nothing selected' : `${count} selected`;
}

/** The title of the question before notes are deleted from a selection. */
export function deleteNotesTitle(count: number): string {
  return count === 1 ? 'Delete this note?' : `Delete ${count} notes?`;
}
