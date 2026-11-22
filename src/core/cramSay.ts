import type { CramSayLinesRequest, CramSayQuestionRequest, CramSaid, Language } from '../reader/api';
import type { Particle } from '../reader/lessons';
import { registerChoice, type RegisterLevel } from '../reader/registerLevel';
import { THEME_FACTS_CHARS, THEME_TOPIC_CHARS, type ThemeWord } from './cramThemes';

/**
 * Talk it through in English (Practice, Cram): the learner works out what they want to say at a lesson
 * by saying it in English first, either answering Claude's questions one at a time or writing it all at
 * once. What they said becomes lines in the language, built from their own words, with the words they
 * reached for and lack marked (server/reader's cram_say.py). Pure, so it's tested. Nothing here
 * schedules or writes a card: a missing word is added through the note queue, where saving is the approval.
 */

/** The server's `cram_say.MAX_TURNS`, `MAX_TURN_CHARS` and `MAX_SAID`: more would be refused. */
export const SAY_TURNS_MAX = 20;
export const SAY_TURN_CHARS = 600;
export const SAY_SAID_MAX = 3000;
/** Questions Claude asks before the chat stops offering another one: enough to cover a topic, few enough to finish. */
export const SAY_QUESTIONS = 5;

export interface SayTurn {
  asker: 'claude' | 'you';
  text: string;
}

const plain = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The request for the next question of the chat: the turns so far (the latest `SAY_TURNS_MAX`), each tidied and kept within what the server takes. */
export function questionRequest(language: Language, topic: string, turns: SayTurn[]): CramSayQuestionRequest {
  return {
    language,
    topic: plain(topic).slice(0, THEME_TOPIC_CHARS),
    turns: turns
      .map((t) => ({ asker: t.asker, text: plain(t.text).slice(0, SAY_TURN_CHARS) }))
      .filter((t) => t.text)
      .slice(-SAY_TURNS_MAX),
  };
}

/** Whether Claude has another question to ask: fewer than `SAY_QUESTIONS` asked, and the last one is answered. */
export function canAskMore(turns: SayTurn[]): boolean {
  return turns.filter((t) => t.asker === 'claude').length < SAY_QUESTIONS && turns[turns.length - 1]?.asker === 'you';
}

/** Whether there's anything to turn into lines: at least one answer with something in it. */
export const hasAnswer = (turns: SayTurn[]): boolean => turns.some((t) => t.asker === 'you' && plain(t.text));

/** A chat as what the learner said: each answer under the question it answers, the newest kept when it's longer than the server takes. */
export function saidFromTurns(turns: SayTurn[]): string {
  const lines: string[] = [];
  let question = '';
  for (const t of turns) {
    const text = plain(t.text);
    if (!text) continue;
    if (t.asker === 'claude') question = text;
    else {
      lines.push(question ? `Asked: ${question} Said: ${text}` : text);
      question = '';
    }
  }
  const joined = lines.join('\n');
  return joined.length > SAY_SAID_MAX ? joined.slice(joined.length - SAY_SAID_MAX) : joined;
}

/** What the free write's box holds as what was said, within what the server takes. */
export const saidFromText = (text: string): string => plain(text).slice(0, SAY_SAID_MAX);

/** The request for the lines: what was said, the words to build them from, the cram's register and (Thai) the learner's polite ending. */
export function linesRequest(language: Language, topic: string, said: string, words: ThemeWord[], register?: RegisterLevel, particle?: Particle): CramSayLinesRequest {
  return {
    language,
    topic: plain(topic).slice(0, THEME_TOPIC_CHARS),
    said,
    words: words.map((w) => ({ id: w.noteId, text: w.text, english: w.english, kind: w.kind })),
    ...registerChoice(register),
    ...(language === 'th' && particle ? { particle } : {}),
  };
}

/** The server's summary as the cram's "What really happened" (`Cram.facts`): cut at a word when it's longer than the cram keeps. */
export function factsFromSummary(summary: string): string {
  const text = plain(summary);
  if (text.length <= THEME_FACTS_CHARS) return text;
  const cut = text.slice(0, THEME_FACTS_CHARS);
  const space = cut.lastIndexOf(' ');
  return (space > THEME_FACTS_CHARS / 2 ? cut.slice(0, space) : cut).trim();
}

/** The words the lines lack that can be queued (they have a meaning, which the note queue needs), each once, in the order they came up. */
export function missingWords(lines: CramSaid[]): { word: string; english: string }[] {
  const seen = new Set<string>();
  const out: { word: string; english: string }[] = [];
  for (const line of lines) {
    for (const m of line.missing) {
      const key = m.word.normalize('NFC').toLowerCase();
      if (!m.english || seen.has(key)) continue;
      seen.add(key);
      out.push({ word: m.word, english: m.english });
    }
  }
  return out;
}

/** What a line's chips say: how many of its words the learner knows, and how many they lack. */
export function sayChips(line: CramSaid): { known?: string; missing?: string } {
  const lack = line.missing.length;
  return {
    ...(line.known ? { known: `${line.known} ${line.known === 1 ? 'word' : 'words'} you know` } : {}),
    ...(lack ? { missing: `${lack} to learn` } : {}),
  };
}
