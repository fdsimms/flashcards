import type { CaseLanguage } from '../cases';

/**
 * Greek words and the case after them. Most prepositions take the accusative; a few, mostly
 * formal, take the genitive.
 */
export const GREEK_CASES: CaseLanguage = {
  cases: ['accusative', 'genitive'],
  governors: [
    { word: 'σε', meaning: 'in, to, at', kind: 'preposition', case: 'accusative' },
    { word: 'με', meaning: 'with', kind: 'preposition', case: 'accusative' },
    { word: 'από', meaning: 'from', kind: 'preposition', case: 'accusative' },
    { word: 'για', meaning: 'for, about', kind: 'preposition', case: 'accusative' },
    { word: 'χωρίς', meaning: 'without', kind: 'preposition', case: 'accusative' },
    { word: 'προς', meaning: 'towards', kind: 'preposition', case: 'accusative' },
    { word: 'ως', meaning: 'until, as far as', kind: 'preposition', case: 'accusative' },
    { word: 'κατά', meaning: 'during, around', kind: 'preposition', case: 'accusative' },
    { word: 'λόγω', meaning: 'because of', kind: 'preposition', case: 'genitive' },
    { word: 'μεταξύ', meaning: 'between', kind: 'preposition', case: 'genitive' },
    { word: 'εναντίον', meaning: 'against', kind: 'preposition', case: 'genitive' },
    { word: 'υπέρ', meaning: 'in favor of', kind: 'preposition', case: 'genitive' },
  ],
};
