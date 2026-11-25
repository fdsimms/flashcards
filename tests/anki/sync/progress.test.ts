import { describe, expect, it } from 'vitest';
import { progressFraction, progressStore, progressText, throttledProgress, type SyncProgress } from '../../../src/anki/sync/progress';

describe('what a running sync says', () => {
  it('names each phase in plain words, with the count where there is one', () => {
    expect(progressText({ phase: 'collection' })).toBe('Syncing your collection.');
    expect(progressText({ phase: 'upload' })).toBe('Sending your collection to the server.');
    expect(progressText({ phase: 'media', done: 340, total: 1200 })).toBe('Syncing images and sounds, 340 of 1,200.');
    expect(progressText({ phase: 'mediaSend', done: 3, total: 10 })).toBe('Sending images and sounds, 3 of 10.');
  });

  it('gives a download its size only once there is a megabyte to say, to one decimal under ten', () => {
    expect(progressText({ phase: 'download', bytes: 0 })).toBe('Downloading your collection.');
    expect(progressText({ phase: 'download', bytes: 600_000 })).toBe('Downloading your collection.');
    expect(progressText({ phase: 'download', bytes: 3.5 * 1024 * 1024 })).toBe('Downloading your collection, 3.5 MB.');
    expect(progressText({ phase: 'download', bytes: 12.4 * 1024 * 1024 })).toBe('Downloading your collection, 12 MB.');
  });

  it('has a fraction only where a total is known, and keeps it between 0 and 1', () => {
    expect(progressFraction({ phase: 'media', done: 300, total: 1200 })).toBe(0.25);
    expect(progressFraction({ phase: 'mediaSend', done: 5, total: 4 })).toBe(1);
    expect(progressFraction({ phase: 'media', done: 0, total: 0 })).toBeUndefined();
    expect(progressFraction({ phase: 'download', bytes: 5_000_000 })).toBeUndefined();
    expect(progressFraction({ phase: 'collection' })).toBeUndefined();
  });
});

describe('throttling progress', () => {
  it('passes on one update per interval within a phase, but every new phase and the last count at once', () => {
    let t = 0;
    const seen: SyncProgress[] = [];
    const emit = throttledProgress((p) => seen.push(p), 250, () => t);
    emit({ phase: 'collection' });
    emit({ phase: 'media', done: 0, total: 100 });
    t = 100; emit({ phase: 'media', done: 10, total: 100 });
    t = 200; emit({ phase: 'media', done: 20, total: 100 });
    t = 300; emit({ phase: 'media', done: 30, total: 100 });
    t = 310; emit({ phase: 'media', done: 100, total: 100 });
    emit({ phase: 'mediaSend', done: 0, total: 2 });
    expect(seen.map((p) => (p.phase === 'media' || p.phase === 'mediaSend' ? `${p.phase} ${p.done}` : p.phase))).toEqual(['collection', 'media 0', 'media 30', 'media 100', 'mediaSend 0']);
  });
});

describe('the store the Sync screen reads', () => {
  it('holds the latest progress, tells subscribers, and clears to null', () => {
    const store = progressStore();
    let told = 0;
    const off = store.subscribe(() => { told++; });
    expect(store.get()).toBeNull();
    store.set({ phase: 'collection' });
    expect(store.get()).toEqual({ phase: 'collection' });
    store.set(null);
    expect(store.get()).toBeNull();
    off();
    store.set({ phase: 'upload' });
    expect(told).toBe(2);
  });
});
