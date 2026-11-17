import { describe, expect, it } from 'vitest';
import { OfflineError } from '../../src/core/connection';
import { holdRecording, parseRecordings, sendHeld, waitingLines } from '../../src/core/held';
import { ApiError } from '../../src/reader/api';

describe('held recordings', () => {
  it('holds each note once, in the newest voice', () => {
    const list = holdRecording(holdRecording([], { noteId: 'a', voice: 'pl-PL-MarekNeural' }), { noteId: 'b', voice: 'v' });
    expect(holdRecording(list, { noteId: 'a', voice: 'w' })).toEqual([{ noteId: 'b', voice: 'v' }, { noteId: 'a', voice: 'w' }]);
  });

  it('reads back only what it wrote', () => {
    expect(parseRecordings([{ noteId: 'a', voice: 'v' }, { noteId: 3 }, null])).toEqual([{ noteId: 'a', voice: 'v' }]);
    expect(parseRecordings('nope')).toEqual([]);
  });
});

describe('sendHeld', () => {
  it('stops at the first item lost to the connection, keeping it and the rest', async () => {
    const sent: number[] = [];
    const result = await sendHeld([1, 2, 3], async (n) => {
      if (n === 2) throw new OfflineError();
      sent.push(n);
    });
    expect(sent).toEqual([1]);
    expect(result).toEqual({ left: [2, 3], refused: [] });
  });

  it("counts the reader server's unreachable error as the connection's", async () => {
    const result = await sendHeld([1], async () => { throw new ApiError("Couldn't reach the server.", 0); });
    expect(result.left).toEqual([1]);
  });

  it('sets a refused item aside and goes on', async () => {
    const refusal = new ApiError("Claude isn't set up.", 503);
    const sent: number[] = [];
    const result = await sendHeld([1, 2], async (n) => {
      if (n === 1) throw refusal;
      sent.push(n);
    });
    expect(sent).toEqual([2]);
    expect(result).toEqual({ left: [], refused: [{ item: 1, error: refusal }] });
  });
});

describe('waitingLines', () => {
  it("lists what's waiting, leaving out what has none", () => {
    expect(waitingLines({ answers: 12, wanikani: 0, words: 1, recordings: 3, readings: 2 })).toEqual([
      '12 answers to sync', '1 word to send to Claude', '3 new notes to record', '2 readings to send to Read & Listen',
    ]);
    expect(waitingLines({ answers: 1, wanikani: 2, words: 0, recordings: 0, readings: 0 })).toEqual(['1 answer to sync', '2 WaniKani answers to send']);
    expect(waitingLines({ answers: 0, wanikani: 0, words: 0, recordings: 0, readings: 0 })).toEqual([]);
  });
});
