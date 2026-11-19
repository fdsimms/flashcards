import type { StoryCharacter, Word } from './api';

/**
 * X-Ray: who a series' characters are, as far as the episode being read (docs/read-and-listen/
 * architecture.md, X-Ray). The server sends only facts from episodes up to it, so nothing here
 * hides a spoiler; this is how the popup, the sheet and the series page pick and word what it sent.
 * Display only: it never schedules or writes a card (tests/reader/noGrading.test.ts).
 */

/** The character a tapped name word is, when the server tagged it as one. */
export function characterOfWord(word: Pick<Word, 'character'>, characters: readonly StoryCharacter[] | undefined): StoryCharacter | null {
  if (!word.character || !characters) return null;
  const name = word.character.trim().toLowerCase();
  return characters.find((c) => c.name.trim().toLowerCase() === name) ?? null;
}

/** "First seen in episode 2". */
export function firstSeen(character: Pick<StoryCharacter, 'first_episode'>): string {
  return `First seen in episode ${character.first_episode}`;
}

/** The sheet's two lists: who turns up in the open episode, then everyone else so far, each in order of first appearance. */
export function xraySections(characters: readonly StoryCharacter[]): { here: StoryCharacter[]; earlier: StoryCharacter[] } {
  const byFirst = [...characters].sort((a, b) => a.first_episode - b.first_episode);
  return { here: byFirst.filter((c) => c.here), earlier: byFirst.filter((c) => !c.here) };
}

/** The letter on a character's badge. */
export function badgeLetter(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase() || '?';
}
