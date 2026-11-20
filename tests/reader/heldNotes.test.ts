import { describe, expect, it } from 'vitest';
import { afterWordsSent, dropWord, heldCounts, holdWords, parseHeldWords, type HeldWords } from '../../src/reader/heldNotes';

describe('held words', () => {
  it("adds to a deck's waiting words, a word already there held once", () => {
    let list = holdWords([], 'pl', 'Polski', [{ entry: 'kot', meaning: 'cat' }]);
    list = holdWords(list, 'pl', 'Polski', [{ entry: 'kot', meaning: 'cat' }, { entry: 'pies', meaning: '' }]);
    list = holdWords(list, 'de', 'Deutsch', [{ entry: 'Hund', meaning: '' }]);
    expect(list).toEqual([
      { language: 'pl', deck: 'Polski', entries: [{ entry: 'kot', meaning: 'cat' }, { entry: 'pies', meaning: '' }] },
      { language: 'de', deck: 'Deutsch', entries: [{ entry: 'Hund', meaning: '' }] },
    ]);
  });

  it('keeps refused words apart from new ones, and counts both', () => {
    const refused: HeldWords = { language: 'pl', deck: 'Polski', entries: [{ entry: 'kot', meaning: '' }], problem: 'No Claude key.' };
    const list = holdWords([refused], 'pl', 'Polski', [{ entry: 'pies', meaning: '' }]);
    expect(list).toHaveLength(2);
    expect(heldCounts(list)).toEqual({ waiting: 1, refused: 1 });
  });

  it('removes a word, and a deck left with none', () => {
    const list = holdWords([], 'pl', 'Polski', [{ entry: 'kot', meaning: '' }]);
    expect(dropWord(list, 'Polski', 'kot')).toEqual([]);
  });

  it('reads back only what it wrote', () => {
    expect(parseHeldWords([{ language: 'pl', deck: 'P', entries: [{ entry: 'kot', meaning: '' }] }, { deck: 'x' }])).toHaveLength(1);
    expect(parseHeldWords(null)).toEqual([]);
  });
});

describe('held words after a send', () => {
  const e = (entry: string) => ({ entry, meaning: '' });
  const group = (deck: string, ...entries: string[]): HeldWords => ({ language: 'pl', deck, entries: entries.map(e) });

  it('takes off the groups that reached the queue, keeps the ones left and marks the refused', () => {
    const [a, b, c] = [group('A', 'kot'), group('B', 'pies'), group('C', 'dom')];
    expect(afterWordsSent([a, b, c], [a, b, c], [c], [{ item: b, problem: 'No.' }])).toEqual([{ ...b, problem: 'No.' }, c]);
  });

  it('does not keep words that were sent when their group changed during the send', () => {
    const sent = group('A', 'kot', 'pies');
    // A word was added to the group while it was being sent, and another removed on the queue screen.
    const added = holdWords([sent], 'pl', 'A', [e('dom')]);
    expect(afterWordsSent(added, [sent], [], [])).toEqual([group('A', 'dom')]);
    const removed = dropWord([sent], 'A', 'kot');
    expect(afterWordsSent(removed, [sent], [], [])).toEqual([]);
  });

  it('keeps a changed group whole when its words were not sent', () => {
    const tried = group('A', 'kot');
    const changed = holdWords([tried], 'pl', 'A', [e('dom')]);
    expect(afterWordsSent(changed, [tried], [tried], [])).toEqual(changed);
    // The same word in another deck is another word.
    expect(afterWordsSent([group('B', 'kot')], [tried], [], [])).toEqual([group('B', 'kot')]);
  });
});
