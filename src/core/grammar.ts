// Franki's grammar points, from the catalog Read & Listen's server reads too
// (server/reader/src/franki_reader/grammar_points.json; docs/grammar.md has the fields and the plan).
// Bundled into the app, so a feature on the phone (Forms practice) can name a point and link to it
// with Read & Listen off. Whether the owner practices or knows a point stays on the server.
import catalog from '../../server/reader/src/franki_reader/grammar_points.json';

/** The languages with grammar points: Read & Listen's languages, by the code Forms practice reads from a note. */
export type GrammarLanguage = 'th' | 'es' | 'de' | 'fr' | 'ru' | 'el' | 'pl' | 'nb';

export interface GrammarPointInfo {
  /** `<language>.<name>`, the id the server and every text's record use: "es.preterite". */
  id: string;
  language: GrammarLanguage;
  /** As the Grammar screen shows it: "Preterite". */
  name: string;
  /** What it means, with examples: "Finished past events: hablé, comió, fueron". */
  note: string;
  /** The Forms field's groups this point is ("preterite"), as Forms practice reads them. */
  forms: string[];
}

type CatalogEntry = Omit<GrammarPointInfo, 'language' | 'forms'> & { language: string; forms?: string[] };

export const GRAMMAR_POINTS: readonly GrammarPointInfo[] = (catalog.points as CatalogEntry[]).map((p) => ({
  ...p,
  language: p.language as GrammarLanguage,
  forms: p.forms ?? [],
}));

/** A language's points, in the catalog's order. */
export function grammarPointsFor(language: string): GrammarPointInfo[] {
  return GRAMMAR_POINTS.filter((p) => p.language === language);
}

/** The point a Forms group belongs to ("preterite" in Spanish is es.preterite), if any. */
export function grammarPointForForms(language: string, group: string): GrammarPointInfo | undefined {
  const wanted = group.trim().toLocaleLowerCase();
  return grammarPointsFor(language).find((p) => p.forms.some((f) => f.toLocaleLowerCase() === wanted));
}
