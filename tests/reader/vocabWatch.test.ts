import { describe, expect, it, vi } from 'vitest';
import { createVocabWatch, watchStateOf } from '../../src/reader/vocabWatch';

describe('vocab watch', () => {
  it('maps a bank state to a watch state', () => {
    expect(watchStateOf('preparing')).toBe('waiting');
    expect(watchStateOf('ready')).toBe('ready');
    expect(watchStateOf('failed')).toBe('failed');
    expect(watchStateOf('unavailable')).toBe('failed');
  });

  it('starts waiting, finishes, and clears, telling listeners each time', () => {
    const w = createVocabWatch();
    const listener = vi.fn();
    w.subscribe(listener);
    expect(w.get()).toBeNull();
    w.start('pl');
    expect(w.get()).toEqual({ language: 'pl', state: 'waiting' });
    w.finish('pl', 'ready');
    expect(w.get()).toEqual({ language: 'pl', state: 'ready' });
    w.clear();
    expect(w.get()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('ignores a finish for another language, or one that is not waiting', () => {
    const w = createVocabWatch();
    w.start('pl');
    w.finish('de', 'ready');
    expect(w.get()).toEqual({ language: 'pl', state: 'waiting' });
    w.finish('pl', 'failed');
    w.finish('pl', 'ready');
    expect(w.get()).toEqual({ language: 'pl', state: 'failed' });
  });

  it('does not notify when clearing nothing, or after unsubscribing', () => {
    const w = createVocabWatch();
    const listener = vi.fn();
    const off = w.subscribe(listener);
    w.clear();
    expect(listener).not.toHaveBeenCalled();
    off();
    w.start('pl');
    expect(listener).not.toHaveBeenCalled();
  });
});
