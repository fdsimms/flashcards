import type { CaseLanguage } from '../cases';

/**
 * German words and the case after them. A two-way preposition (in, auf, an) is listed once for
 * motion (accusative) and once for location (dative).
 */
export const GERMAN_CASES: CaseLanguage = {
  cases: ['accusative', 'dative', 'genitive'],
  governors: [
    { word: 'durch', meaning: 'through', kind: 'preposition', case: 'accusative' },
    { word: 'für', meaning: 'for', kind: 'preposition', case: 'accusative' },
    { word: 'gegen', meaning: 'against', kind: 'preposition', case: 'accusative' },
    { word: 'ohne', meaning: 'without', kind: 'preposition', case: 'accusative' },
    { word: 'um', meaning: 'around', kind: 'preposition', case: 'accusative' },
    { word: 'in', meaning: 'into', kind: 'preposition', case: 'accusative', sense: 'motion' },
    { word: 'auf', meaning: 'onto', kind: 'preposition', case: 'accusative', sense: 'motion' },
    { word: 'an', meaning: 'to (the side of)', kind: 'preposition', case: 'accusative', sense: 'motion' },
    { word: 'aus', meaning: 'out of, from', kind: 'preposition', case: 'dative' },
    { word: 'bei', meaning: 'at, near', kind: 'preposition', case: 'dative' },
    { word: 'mit', meaning: 'with', kind: 'preposition', case: 'dative' },
    { word: 'nach', meaning: 'after, to', kind: 'preposition', case: 'dative' },
    { word: 'seit', meaning: 'since, for (time)', kind: 'preposition', case: 'dative' },
    { word: 'von', meaning: 'from, of', kind: 'preposition', case: 'dative' },
    { word: 'zu', meaning: 'to', kind: 'preposition', case: 'dative' },
    { word: 'in', meaning: 'in', kind: 'preposition', case: 'dative', sense: 'location' },
    { word: 'auf', meaning: 'on', kind: 'preposition', case: 'dative', sense: 'location' },
    { word: 'an', meaning: 'at, on (the side of)', kind: 'preposition', case: 'dative', sense: 'location' },
    { word: 'helfen', meaning: 'to help', kind: 'verb', case: 'dative', person: true },
    { word: 'danken', meaning: 'to thank', kind: 'verb', case: 'dative', person: true },
    { word: 'gefallen', meaning: 'to be liked by', kind: 'verb', case: 'dative', person: true },
    { word: 'gehören', meaning: 'to belong to', kind: 'verb', case: 'dative', person: true },
    { word: 'antworten', meaning: 'to answer (someone)', kind: 'verb', case: 'dative', person: true },
    { word: 'wegen', meaning: 'because of', kind: 'preposition', case: 'genitive' },
    { word: 'während', meaning: 'during', kind: 'preposition', case: 'genitive' },
    { word: 'trotz', meaning: 'despite', kind: 'preposition', case: 'genitive' },
    { word: 'statt', meaning: 'instead of', kind: 'preposition', case: 'genitive' },
  ],
};
