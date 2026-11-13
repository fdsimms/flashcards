import { describe, expect, it } from 'vitest';
import type { DeckRow } from '../../src/core/deckTree';
import { DEFAULT_REMINDER, parseReminder, reminderPlan, reminderText } from '../../src/core/reminder';
import { NOW } from '../support/fixtures';

const H = 4;
const row = (deck: string, due: number, fresh: number): DeckRow => {
  const parts = deck.split('::');
  return { deck, name: parts[parts.length - 1], depth: parts.length - 1, due, fresh, total: due + fresh, unstudied: fresh };
};
const rows = [
  row('🧠 Trivia', 64, 1),
  row('👅 Languages', 370, 9),
  row('👅 Languages::🐘 ภาษาไทย', 216, 10),
  row('💻 System Design', 0, 0),
];
const on = { on: true, hour: 20, minute: 0 };

describe('the reminder setting', () => {
  it('is off until turned on, at 8 PM', () => {
    expect(parseReminder(null)).toEqual(DEFAULT_REMINDER);
    expect(DEFAULT_REMINDER.on).toBe(false);
  });

  it('keeps what was saved, and falls back to the default for anything unreadable', () => {
    expect(parseReminder(JSON.stringify({ on: true, hour: 7, minute: 30 }))).toEqual({ on: true, hour: 7, minute: 30 });
    expect(parseReminder(JSON.stringify({ on: 'yes', hour: 24, minute: 2.5 }))).toEqual(DEFAULT_REMINDER);
    expect(parseReminder('not json')).toEqual(DEFAULT_REMINDER);
  });
});

describe('what the reminder says', () => {
  it('counts the top-level decks only, so a subdeck isn\'t counted twice, busiest first', () => {
    expect(reminderText(rows)).toEqual({ title: '434 reviews and 10 new cards', body: '👅 Languages 379 · 🧠 Trivia 65' });
  });

  it('leaves out a part with nothing in it, and says nothing when nothing is waiting', () => {
    expect(reminderText([row('A', 1, 0)])).toEqual({ title: '1 review', body: 'A 1' });
    expect(reminderText([row('A', 0, 2)])?.title).toBe('2 new cards');
    expect(reminderText([row('A', 0, 0)])).toBeNull();
  });
});

describe('the reminders scheduled', () => {
  it('schedules none while it\'s off', () => {
    expect(reminderPlan({ prefs: { ...on, on: false }, rows, now: NOW, dayStartsAtHour: H })).toEqual([]);
  });

  it('puts today\'s counts on tonight\'s reminder, and plain words on the days after', () => {
    // NOW is noon.
    const plan = reminderPlan({ prefs: on, rows, now: NOW, dayStartsAtHour: H, days: 3 });
    expect(plan.map((p) => p.at)).toEqual([new Date(2026, 10, 11, 20), new Date(2026, 10, 12, 20), new Date(2026, 10, 13, 20)]);
    expect(plan[0].title).toBe('434 reviews and 10 new cards');
    expect(plan[1]).toMatchObject({ title: 'Time to study', body: "Open Franki to see what's due today." });
  });

  it('starts tomorrow once today\'s time has passed', () => {
    const plan = reminderPlan({ prefs: { ...on, hour: 9 }, rows, now: NOW, dayStartsAtHour: H, days: 1 });
    expect(plan).toEqual([{ at: new Date(2026, 10, 12, 9), title: 'Time to study', body: "Open Franki to see what's due today." }]);
  });

  it('counts a reminder before the day starts as part of the day before', () => {
    // 1 AM tomorrow is still today's study day.
    const plan = reminderPlan({ prefs: { ...on, hour: 1 }, rows, now: NOW, dayStartsAtHour: H, days: 2 });
    expect(plan[0]).toMatchObject({ at: new Date(2026, 10, 12, 1), title: '434 reviews and 10 new cards' });
    expect(plan[1].title).toBe('Time to study');
  });

  it('skips today\'s reminder when everything is done, and still writes the later ones', () => {
    const plan = reminderPlan({ prefs: on, rows: [row('A', 0, 0)], now: NOW, dayStartsAtHour: H, days: 2 });
    expect(plan.map((p) => p.at)).toEqual([new Date(2026, 10, 12, 20)]);
  });

  it('keeps the clock time across a change of daylight saving time', () => {
    const plan = reminderPlan({ prefs: on, rows, now: new Date(2026, 10, 1, 12), dayStartsAtHour: H, days: 3 });
    expect(plan.map((p) => [p.at.getHours(), p.at.getMinutes()])).toEqual([[20, 0], [20, 0], [20, 0]]);
  });
});
