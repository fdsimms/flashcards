// Your topics (docs/grammar.md, "Your topics"): grammar pages Claude writes for a topic the catalog doesn't
// have. What the screens decide, pure so it's tested; nothing here grades a card, schedules anything or
// writes a note. The server keeps the pages (server/reader topics.py).
import type { GrammarTopic, GrammarTopicRow, Language, SituationFocus } from './api';
import { daysAgo } from './grammar';

/** Characters in a topic's title, as the server takes them. */
export const TOPIC_TITLE_MAX = 80;

/** How long the screens wait between asking whether a page being written is ready. */
export const TOPIC_POLL_MS = 3000;

/** A title as sent: spaces collapsed and trimmed. Empty means there's nothing to write yet. */
export function topicTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, TOPIC_TITLE_MAX);
}

/** Whether the page is still being written, so the screen asks again. */
export const topicWriting = (topic: Pick<GrammarTopic, 'status'>) => topic.status === 'writing';

/** What the list shows under a topic: "Written by Claude · 3 days ago", or that it's being written or failed. */
export function topicLine(row: GrammarTopicRow, now: Date, dayStartsAtHour: number): string {
  if (row.status === 'writing') return 'Being written';
  if (row.status === 'failed') return "Couldn't be written. Open it to try again.";
  return `Written by Claude · ${daysAgo(new Date(row.created_at), now, dayStartsAtHour)}`;
}

/** What Situations is told when it opens from a topic: the title and the one-line idea. */
export const topicFocus = (topic: Pick<GrammarTopic, 'title' | 'lead'>): SituationFocus => ({ title: topic.title, lead: topic.lead });

/**
 * Topics worth suggesting when asking for one, by language: grammar the catalog's points don't cover.
 * Typing anything else works; these only save typing.
 */
export const TOPIC_IDEAS: Partial<Record<Language, string[]>> = {
  th: ['Serial verbs', 'Classifiers', 'Polite particles', 'Word order in questions'],
  es: ['Ser and estar', 'Por and para', 'Reflexive verbs', 'Object pronouns'],
  de: ['Cases after prepositions', 'Separable verbs', 'Adjective endings', 'Word order in subordinate clauses'],
  fr: ['Object pronouns', 'Partitive articles', 'Reflexive verbs', 'Negation'],
  ru: ['Verbs of motion', 'Aspect pairs', 'Cases after prepositions', 'Numbers and nouns'],
  el: ['Articles and cases', 'Verbs ending in -ω', 'Prepositions', 'Negation'],
  pl: ['Cases', 'Verbs of motion', 'Aspect pairs', 'Numbers and nouns'],
  nb: ['Word order with adverbs', 'Definite endings', 'Reflexive verbs', 'Modal verbs'],
  ja: ['Particles は and が', 'Counters', 'Giving and receiving verbs', 'Casual speech'],
  en: ['Phrasal verbs', 'Articles', 'Prepositions of time', 'Conditionals'],
};

/** The ideas for a language, minus any topic it already has (compared ignoring case). */
export function topicIdeas(language: Language, existing: Pick<GrammarTopicRow, 'title'>[]): string[] {
  const have = new Set(existing.map((t) => t.title.toLocaleLowerCase()));
  return (TOPIC_IDEAS[language] ?? []).filter((idea) => !have.has(idea.toLocaleLowerCase()));
}
