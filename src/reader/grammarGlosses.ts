// Word meanings on a grammar point's explanation: each phrase set in the language's own words
// (`**ไปไหม**`) is split and glossed by Read & Listen's server as a card's example sentence is
// (cardGlosses.ts), so each word in it can be tapped for the reader's popover. Only reads: nothing
// here grades or writes a card. ui/GrammarExplanation.tsx asks the server and draws the words.
import type { ExplanationRun } from '../core/grammar';
import type { Language, Word } from './api';
import { glossesOf, glossKey, MAX_SENTENCES, type GlossRequest } from './cardGlosses';

/** The language's phrases in an explanation, each once, as the server is asked about them; null when there are none. */
export function explanationRequest(language: Language, paragraphs: ExplanationRun[][]): GlossRequest | null {
  const texts = new Set<string>();
  for (const para of paragraphs) for (const run of para) if (run.language) texts.add(run.text);
  if (!texts.size) return null;
  return { language, sentences: [...texts].slice(0, MAX_SENTENCES).map((text) => ({ text, english: '' })) };
}

/**
 * The server's answer for `request`, by phrase. A phrase whose words don't join back to it exactly
 * is left out (`glossesOf`), so it shows as it was rather than as words that don't match it.
 */
export function explanationGlosses(request: GlossRequest, answer: Word[][]): Map<string, Word[]> {
  const out = new Map<string, Word[]>();
  for (const [key, words] of glossesOf(request, answer)) out.set(key.slice(glossKey(request.language, '').length), words);
  return out;
}
