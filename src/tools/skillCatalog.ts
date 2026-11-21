import { deckNameLanguage, LANG_TAGS } from '../core/cards';
import { LANGUAGE_ORDER, LANGUAGES } from '../reader/languages';
import { DRILL_STEPS, SKILL_NOTE_TYPE, SKILL_TAG, SKILLS_SUBDECK, skillDrafts, skillGroups, skillWordDrafts } from './skills';
import { SKILL_WORD_NOTE_TYPE, stepNeeds } from './skillWords';

/**
 * Everything the MCP's daily job needs to add skill cards (server/mcp/franki_mcp/skills.py), written
 * out of this app's own definitions to server/mcp/franki_mcp/skill_catalog.json: which language a deck
 * name means, each language's groups, and the notes each group adds. The server has no copy of the
 * skills to keep in step; `tests/tools/skillCatalog.test.ts` fails when the file is stale, and
 * `npm run catalog:skills` rewrites it.
 */
export interface SkillCatalog {
  noteType: string;
  /** The note type the words a skill needs are written in. */
  wordNoteType: string;
  tag: string;
  subdeck: string;
  /** The drill steps that wait on the step before (`DrillStep.after`) or on the deck's words (`stepWaits`): resuming paused skill cards leaves them suspended for Review to release. */
  laterSteps: string[];
  /** The names a deck's name is searched for (`deckNameLanguage`), each with its language code, or null for a language with no skill cards. */
  deckKeys: [string, string | null][];
  /** Deck names with the language the app reads from each: the MCP's `language_of_deck` is tested against them, so the two can't drift. */
  deckExamples: [string, string | null][];
  languages: Record<string, {
    name: string;
    groups: {
      id: string;
      title: string;
      notes: { front: string; back: string; tags: string[]; suspended: boolean }[];
      /** The words the skill needs, as notes of `wordNoteType`: added too when the deck lacks them (`missingWordDrafts`). */
      words: { fields: Record<string, string>; tags: string[] }[];
    }[];
  }>;
}

/** Deck names that test the rules of `deckNameLanguage`: whole words, top level first, scripts without spaces. */
const DECK_EXAMPLES = [
  'Thai', '🐟 Norsk', 'Polski', 'Deutsch::Verbs', 'Trivia', 'Japanese', 'Italiano', '👅 Languages::🐘 ภาษาไทย::Tier 1',
  'ภาษาไทยพื้นฐาน', 'ไทย', '👅 Languages::🍥 日本語', 'Trivia::Geography::Thailand', 'Trivia::Greek mythology', 'Prussian history',
  'Gdansk trip', 'Russian::Polish cognates', 'Polish for Thai speakers', 'Spanish::French false friends', 'thai-thai', 'Español (México)',
];

export function skillCatalog(): SkillCatalog {
  const withSkills = LANGUAGE_ORDER.filter((l) => skillGroups(l).length);
  const languageOfSpeech = (speech: string) => withSkills.find((l) => LANGUAGES[l].speech === speech) ?? null;
  return {
    noteType: SKILL_NOTE_TYPE,
    wordNoteType: SKILL_WORD_NOTE_TYPE,
    tag: SKILL_TAG,
    subdeck: SKILLS_SUBDECK,
    laterSteps: DRILL_STEPS.filter((s) => s.after || LANGUAGE_ORDER.some((l) => stepNeeds(s.id, l).length)).map((s) => s.id),
    deckKeys: Object.entries(LANG_TAGS).map(([key, speech]) => [key, languageOfSpeech(speech)]),
    deckExamples: DECK_EXAMPLES.map((deck) => {
      const speech = deckNameLanguage(deck);
      return [deck, speech ? languageOfSpeech(speech) : null];
    }),
    languages: Object.fromEntries(withSkills.map((l) => [l, {
      name: LANGUAGES[l].name,
      groups: skillGroups(l).map((g) => ({
        id: g.id,
        title: g.title,
        notes: skillDrafts(l, LANGUAGES[l].name, [g.id]).map((d) => ({ front: d.fields.Front, back: d.fields.Back, tags: d.tags, suspended: d.suspended })),
        words: skillWordDrafts(l, [g.id]).map((d) => ({ fields: d.fields, tags: d.tags })),
      })),
    }])),
  };
}
