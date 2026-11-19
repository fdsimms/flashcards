import { describe, expect, it } from 'vitest';
import type { AudioLesson, PastText, ShelfText } from '../../src/reader/api';
import {
  advance, back, backRestarts, clearNext, dropIndex, EMPTY_QUEUE, shiftFor, has, HISTORY_LIMIT, itemDetail, keepPlayingPick, keyOf, lessonItem,
  listenLog, moreAfter, move, nextRepeat, parseQueue, pastItem, playLater, playNext, playNow, remove, restoreNext, setResume,
  shelfItem, sleepDelay, sleepIn, sleepLabel, type AudioQueue, type QueueItem,
} from '../../src/reader/audioQueue';

const lesson = (id: number, title = `Lesson ${id}`): AudioLesson => ({
  id, language: 'fr', scene: 'coffee', title, state: 'ready', error: '', duration_ms: 292_000, created_at: '2026-11-18T10:00', phrases: [], dialogue: [],
});
const card = (id: number, title = `Text ${id}`): ShelfText => ({
  id, title, topic: 'market', topic_id: 1, form: 'dialogue', lines: 12, stretch: [], reason: 'new', coverage: 0.96, episode: 0,
} as unknown as ShelfText);
const text = (id: number) => shelfItem(card(id), 'th');
const keys = (items: readonly QueueItem[]) => items.map(keyOf);
const queue = (now: QueueItem | null, ...next: QueueItem[]): AudioQueue => ({ ...EMPTY_QUEUE, now, next });

describe('adding to Up Next', () => {
  it('plays an item now, putting the one playing back at the top with its place kept', () => {
    const q = playNow(queue({ ...text(1), resume: 4 }, text(2)), lessonItem(lesson(9)));
    expect(keyOf(q.now!)).toBe('lesson:9');
    expect(keys(q.next)).toEqual(['text:1', 'text:2']);
    expect(q.next[0].resume).toBe(4);
  });

  it('plays an item already queued now with the place it had, taking it out of Up Next', () => {
    const q = playNow(queue(text(1), { ...text(2), resume: 3 }, text(3)), text(2));
    expect(q.now).toMatchObject({ textId: 2, resume: 3 });
    expect(keys(q.next)).toEqual(['text:1', 'text:3']);
  });

  it('leaves the queue alone when the item asked for is already playing', () => {
    const q = queue(text(1), text(2));
    expect(playNow(q, text(1))).toBe(q);
    expect(playNext(q, text(1))).toBe(q);
    expect(playLater(q, text(1))).toBe(q);
  });

  it('puts Play Next first and Play Later last, never twice', () => {
    let q = queue(text(1), text(2), text(3));
    q = playNext(q, text(3));
    expect(keys(q.next)).toEqual(['text:3', 'text:2']);
    q = playLater(q, text(3));
    expect(keys(q.next)).toEqual(['text:2', 'text:3']);
  });

  it('makes the first item added the one playing when the queue is empty', () => {
    expect(keyOf(playLater(EMPTY_QUEUE, text(5)).now!)).toBe('text:5');
    expect(keyOf(playNext(EMPTY_QUEUE, text(5)).now!)).toBe('text:5');
  });

  it('says whether an item is queued', () => {
    const q = queue(text(1), lessonItem(lesson(2)));
    expect(has(q, 'text:1')).toBe(true);
    expect(has(q, 'lesson:2')).toBe(true);
    expect(has(q, 'text:2')).toBe(false);
  });
});

describe('changing Up Next', () => {
  it('removes an item, and removing the one playing moves the next one up', () => {
    const q = queue(text(1), text(2), text(3));
    expect(keys(remove(q, 'text:2').next)).toEqual(['text:3']);
    const r = remove(q, 'text:1');
    expect(keyOf(r.now!)).toBe('text:2');
    expect(keys(r.next)).toEqual(['text:3']);
    expect(remove(queue(text(1)), 'text:1').now).toBeNull();
  });

  it('reorders by index, keeping the move inside the list', () => {
    const q = queue(text(1), text(2), text(3), text(4));
    expect(keys(move(q, 0, 2).next)).toEqual(['text:3', 'text:4', 'text:2']);
    expect(keys(move(q, 2, 0).next)).toEqual(['text:4', 'text:2', 'text:3']);
    expect(keys(move(q, 1, 99).next)).toEqual(['text:2', 'text:4', 'text:3']);
    expect(move(q, 5, 0)).toBe(q);
  });

  it('clears Up Next and puts it back on Undo after anything added since', () => {
    const { queue: cleared, removed } = clearNext(queue(text(1), text(2), text(3)));
    expect(cleared.next).toEqual([]);
    const added = playLater(cleared, text(3));
    expect(keys(restoreNext(added, removed).next)).toEqual(['text:3', 'text:2']);
  });

  it('keeps where an item stopped, and forgets it with null', () => {
    let q = queue(text(1), text(2));
    q = setResume(q, 'text:1', 5);
    q = setResume(q, 'text:2', 7);
    expect(q.now!.resume).toBe(5);
    expect(q.next[0].resume).toBe(7);
    expect(setResume(q, 'text:1', null).now!.resume).toBeUndefined();
    expect(setResume(q, 'text:9', 1)).toBe(q);
  });
});

describe('playing through', () => {
  it('moves on to the next item and keeps the finished one in Recently played', () => {
    const q = advance(queue({ ...text(1), resume: 6 }, text(2)));
    expect(keyOf(q.now!)).toBe('text:2');
    expect(keys(q.history)).toEqual(['text:1']);
    expect(q.history[0].resume).toBeUndefined();
  });

  it('ends with nothing playing once Up Next is empty', () => {
    expect(advance(queue(text(1))).now).toBeNull();
  });

  it('puts a finished item at the end again under Repeat all, and plays a queue of one again', () => {
    const q = advance({ ...queue(text(1), text(2)), repeat: 'all' });
    expect(keys(q.next)).toEqual(['text:1']);
    const one = advance({ ...queue(text(1)), repeat: 'all' });
    expect(keyOf(one.now!)).toBe('text:1');
  });

  it('keeps Recently played to its limit, newest first, with no repeats', () => {
    let q = queue(text(0));
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) q = advance(playLater(q, text(i)));
    expect(q.history).toHaveLength(HISTORY_LIMIT);
    expect(keyOf(q.history[0])).toBe(`text:${HISTORY_LIMIT + 4}`);
    q = advance(playNow(q, text(HISTORY_LIMIT + 4)));
    expect(q.history.filter((i) => keyOf(i) === `text:${HISTORY_LIMIT + 4}`)).toHaveLength(1);
  });

  it('goes back to the last played from its start, with the one playing first in Up Next', () => {
    const played = advance(queue({ ...text(1), resume: 3 }, text(2)));
    const q = back(setResume(played, 'text:2', 4))!;
    expect(keyOf(q.now!)).toBe('text:1');
    expect(q.now!.resume).toBeUndefined();
    expect(q.next[0]).toMatchObject({ textId: 2, resume: 4 });
    expect(q.history).toEqual([]);
    expect(back(queue(text(1)))).toBeNull();
  });

  it('starts the item playing again on Previous past its first few seconds or first line', () => {
    expect(backRestarts({ kind: 'lesson', seconds: 2 })).toBe(false);
    expect(backRestarts({ kind: 'lesson', seconds: 10 })).toBe(true);
    expect(backRestarts({ kind: 'text', line: 0, first: 0 })).toBe(false);
    expect(backRestarts({ kind: 'text', line: 3, first: 0 })).toBe(true);
  });

  it('steps repeat through off, all, one', () => {
    expect(nextRepeat('off')).toBe('all');
    expect(nextRepeat('all')).toBe('one');
    expect(nextRepeat('one')).toBe('off');
  });
});

describe('Keep playing the shelf', () => {
  const shelf = { language: 'th' as const, texts: [card(1), card(2), card(3), card(4)] };

  it('picks the first shelf text not played lately or queued', () => {
    const q = { ...queue(null, text(3)), history: [text(2)] };
    expect(keepPlayingPick(q, text(1), shelf)?.id).toBe(4);
  });

  it('picks nothing after a lesson, a past text, or a text of another language', () => {
    expect(keepPlayingPick(EMPTY_QUEUE, lessonItem(lesson(1)), shelf)).toBeNull();
    expect(keepPlayingPick(EMPTY_QUEUE, pastItem({ id: 1, title: 'x' } as PastText, 'th'), shelf)).toBeNull();
    expect(keepPlayingPick(EMPTY_QUEUE, shelfItem(card(1), 'pl'), shelf)).toBeNull();
  });
});

describe('logging a text played through', () => {
  it('logs a shelf text as read by listening, with nothing looked up', () => {
    expect(listenLog(text(1), 95.4, 0.65, false)).toEqual({
      kind: 'reading',
      log: { finished: true, words_glossed: [], words_flagged: [], audio_speed: 0.65, listen_only: true, seconds: 95 },
    });
  });

  it('logs a past text as heard again', () => {
    expect(listenLog(pastItem({ id: 4, title: 'x', form: 'story' } as PastText, 'th'), 60, 1, false)).toEqual({ kind: 'listen' });
  });

  it("doesn't log an episode that ends on a choice, or a text the reader already logged", () => {
    expect(listenLog(text(1), 60, 1, true)).toBeNull();
    expect(listenLog({ ...text(1), from: null }, 60, 1, false)).toBeNull();
  });
});

describe('what a row says', () => {
  it('says what an item is, and where it starts again', () => {
    expect(itemDetail(text(1))).toBe('Dialogue · 12 lines');
    expect(itemDetail({ ...text(1), resume: 3 })).toBe('Dialogue · started, line 4');
    expect(itemDetail(lessonItem(lesson(1)))).toBe('Lesson · 4:52');
    expect(itemDetail({ ...lessonItem(lesson(1)), resume: 83 })).toBe('Lesson · started, 1:23 of 4:52');
    expect(itemDetail(pastItem({ id: 4, title: 'x', form: 'story' } as PastText, 'th'))).toBe('Story');
  });

  it('counts what comes after the one playing', () => {
    expect(moreAfter(queue(text(1)))).toBeNull();
    expect(moreAfter(queue(text(1), text(2), text(3)))).toBe('then 2 more');
  });
});

describe('the sleep timer', () => {
  const now = new Date(2026, 10, 19, 22, 0).getTime();

  it('counts minutes down, rounding up', () => {
    const timer = sleepIn(15, now);
    expect(sleepLabel(timer, now)).toBe('15 min');
    expect(sleepLabel(timer, now + 60_000 * 14 + 1)).toBe('1 min');
    expect(sleepDelay(timer, now + 60_000)).toBe(14 * 60_000);
    expect(sleepDelay(timer, now + 60_000 * 20)).toBe(0);
  });

  it('names End of item and no timer', () => {
    expect(sleepLabel({ kind: 'item' }, now)).toBe('End of item');
    expect(sleepLabel(null, now)).toBe('Sleep timer');
    expect(sleepDelay({ kind: 'item' }, now)).toBeNull();
  });
});

describe('the queue kept on the phone', () => {
  it('reads back what was written', () => {
    const q: AudioQueue = { ...queue({ ...text(1), resume: 2 }, lessonItem(lesson(3))), history: [text(9)], repeat: 'one', keepPlaying: true };
    expect(parseQueue(JSON.parse(JSON.stringify(q)))).toEqual(q);
  });

  it('drops what it can not read, and repeats', () => {
    const q = parseQueue({ version: 1, now: { kind: 'text' }, next: [text(1), { kind: 'video' }, text(1), lessonItem(lesson(2))], history: 'x', repeat: 'sometimes' });
    expect(keyOf(q.now!)).toBe('text:1');
    expect(keys(q.next)).toEqual(['lesson:2']);
    expect(q.history).toEqual([]);
    expect(q.repeat).toBe('off');
    expect(parseQueue(null)).toEqual(EMPTY_QUEUE);
    expect(parseQueue({ version: 2 })).toEqual(EMPTY_QUEUE);
  });
});

describe('dragging a row', () => {
  it('lands on the row it has moved past half of, inside the list', () => {
    expect(dropIndex(1, 20, 60, 5)).toBe(1);
    expect(dropIndex(1, 40, 60, 5)).toBe(2);
    expect(dropIndex(1, -100, 60, 5)).toBe(0);
    expect(dropIndex(1, 1000, 60, 5)).toBe(4);
    expect(dropIndex(1, 1000, 0, 5)).toBe(1);
  });

  it('moves the rows between aside to open the gap', () => {
    // Row 1 held over row 3: rows 2 and 3 move up a row.
    expect([0, 1, 2, 3, 4].map((i) => shiftFor(i, 1, 3))).toEqual([0, 0, -1, -1, 0]);
    // Row 3 held over row 1: rows 1 and 2 move down.
    expect([0, 1, 2, 3, 4].map((i) => shiftFor(i, 3, 1))).toEqual([0, 1, 1, 0, 0]);
  });
});
