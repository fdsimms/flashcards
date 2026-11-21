import { isOmnilanguage } from './cards';
import { rendersWithFields, templateFieldNames, templateOrdinals } from './template';
import type { Note, NoteType } from './types';

/**
 * Editing a note type's card templates and styling (the Note type screen): the checks Anki makes
 * before it takes a changed template, and what Anki works out from the templates when it saves
 * them. Fields and card types aren't changed here, so nothing in this file changes a note type's
 * schema, and the change syncs without a full upload.
 */

/** The fields Anki fills in itself, which any template may name (rslib template.rs). */
const SPECIAL_FIELDS = new Set(['FrontSide', 'Card', 'CardFlag', 'Deck', 'Subdeck', 'Tags', 'Type', 'CardID']);

export interface TemplateProblem {
  /** The card type's ordinal; absent for a problem with the note type as a whole. */
  ord: number;
  side: 'front' | 'back';
  message: string;
}

/** True when the template holds a replacement with the `cloze` filter, e.g. {{cloze:Text}} or {{type:cloze:Text}}. */
function hasClozeReplacement(template: string): boolean {
  for (const m of template.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const parts = m[1].split(':');
    if (parts.slice(0, -1).some((f) => f.trim() === 'cloze')) return true;
  }
  return false;
}

/**
 * What Anki would refuse in a note type's templates, each with what to change (rslib
 * notetype/mod.rs, checked against Anki itself): a template it can't parse, a field the note type
 * doesn't have, a front that names no field at all, two card types with the same front, and a
 * cloze note type with no {{cloze:Field}} on a side. Empty when Anki would take the note type.
 */
export function templateProblems(noteType: NoteType): TemplateProblem[] {
  const out: TemplateProblem[] = [];
  const known = new Set(noteType.fields);
  const example = noteType.fields[0] ?? 'Front';
  for (const t of noteType.templates) {
    for (const side of ['front', 'back'] as const) {
      const text = side === 'front' ? t.front : t.back;
      const sideName = `${t.name}'s ${side}`;
      const names = templateFieldNames(text);
      if (!names) {
        out.push({ ord: t.ord, side, message: `${sideName} can't be read. Each {{#Field}} or {{^Field}} needs a {{/Field}} after it, with the same name.` });
        continue;
      }
      const unknown = names.find((n) => n !== '' && !known.has(n) && !SPECIAL_FIELDS.has(n));
      if (unknown !== undefined) {
        out.push({ ord: t.ord, side, message: `${sideName} uses a field called ${unknown}. This note type has no such field.` });
        continue;
      }
      if (side === 'front' && !names.some((n) => n !== '')) {
        out.push({ ord: t.ord, side, message: `${sideName} shows no field. Add one, e.g. {{${example}}}.` });
        continue;
      }
      if (noteType.kind === 'cloze' && !hasClozeReplacement(text)) {
        out.push({ ord: t.ord, side, message: `${sideName} needs a cloze field, e.g. {{cloze:${example}}}.` });
        continue;
      }
      if (side === 'front') {
        const same = noteType.templates.find((o) => o.ord < t.ord && o.front === t.front);
        if (same) out.push({ ord: t.ord, side, message: `${sideName} is the same as ${same.name}'s. Each card type needs a different front.` });
      }
    }
  }
  return out;
}

export interface CardRequirement {
  ord: number;
  kind: 'none' | 'any' | 'all';
  /** The fields' ordinals, smallest first. */
  fieldOrds: number[];
}

/**
 * Which fields each card type needs filled to make a card, as Anki works it out from the front
 * template whenever it saves a note type (`update_requirements` and `requirements` in rslib):
 * kept in the note type for older Anki clients.
 */
export function cardRequirements(noteType: NoteType): CardRequirement[] {
  const fields = noteType.fields;
  return noteType.templates.map((t) => {
    if (!templateFieldNames(t.front)) return { ord: t.ord, kind: 'none', fieldOrds: [] };
    const any = fields.map((_, i) => i).filter((i) => rendersWithFields(t.front, new Set([fields[i]])));
    if (any.length) return { ord: t.ord, kind: 'any', fieldOrds: any };
    // Otherwise the fields without which the front, with every field filled, shows nothing.
    const all = new Set(fields);
    const needed: number[] = [];
    for (const [i, name] of fields.entries()) {
      all.delete(name);
      if (!rendersWithFields(t.front, all)) needed.push(i);
      all.add(name);
    }
    return needed.length && rendersWithFields(t.front, all)
      ? { ord: t.ord, kind: 'all', fieldOrds: needed }
      : { ord: t.ord, kind: 'none', fieldOrds: [] };
  });
}

/**
 * How many of `notes` would get a card they don't have yet with the templates of `noteType`: Anki
 * adds those cards when a template changes, and Franki doesn't yet, so an edit that would is
 * refused. `ordsOf` gives the template ordinals a note has cards for now.
 */
export function notesGainingCards(notes: Note[], noteType: NoteType, ordsOf: (note: Note) => Set<number>): number {
  let n = 0;
  for (const note of notes) {
    if (note.model !== noteType.name) continue;
    const has = ordsOf(note);
    if (templateOrdinals(note, noteType).some((o) => !has.has(o))) n++;
  }
  return n;
}

/** A note type's line on the Note types list: how many notes use it, and how many card types it has. */
export function noteTypeSummary(noteType: NoteType, notes: number): string {
  const count = `${notes.toLocaleString('en-US')} ${notes === 1 ? 'note' : 'notes'}`;
  if (noteType.kind === 'cloze') return `${count}. Cloze`;
  const n = noteType.templates.length;
  return `${count}. ${n} ${n === 1 ? 'card type' : 'card types'}`;
}

/** Whether Franki draws this note type's cards itself (Omnilanguage), so its templates change only how Anki shows them. */
export function drawnByFranki(noteType: NoteType): boolean {
  return isOmnilanguage({ id: '', deck: '', model: noteType.name, tags: [], fields: Object.fromEntries(noteType.fields.map((f) => [f, ''])) });
}
