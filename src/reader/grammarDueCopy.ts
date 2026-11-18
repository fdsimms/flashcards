import type { Language } from './api';
import { LANGUAGES } from './languages';

/** Grammar due today: in each language with some, most first, and in all. */
export interface GrammarDue {
  total: number;
  languages: { language: Language; count: number }[];
}

/**
 * The phone's copy of `GrammarDue`, so Today can show its grammar chips the moment it opens
 * instead of after Read & Listen's server answers. Tagged with the study day it was worked out for
 * (`studyDayKey`): a copy from an earlier day says nothing about today and is ignored.
 */
export function encodeGrammarDue(due: GrammarDue, day: string): string {
  return JSON.stringify({ day, due });
}

export function decodeGrammarDue(raw: string | null | undefined, day: string): GrammarDue | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o?.day !== day || !Array.isArray(o.due?.languages)) return null;
    const languages: GrammarDue['languages'] = [];
    for (const l of o.due.languages) {
      if (!(l?.language in LANGUAGES) || !Number.isInteger(l.count) || l.count < 0) return null;
      languages.push({ language: l.language as Language, count: l.count });
    }
    return { total: languages.reduce((n, l) => n + l.count, 0), languages };
  } catch {
    return null;
  }
}
