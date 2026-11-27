import { expect, test } from 'vitest';
import { clampRotateCount, dailyModeLabel, dailyModeOf, dailyTasksSummary } from '../../src/reader/dailyTasks';

test('a language nobody chose rotates, as the server reads it', () => {
  expect(dailyModeOf({}, 'de')).toBe('rotate');
  expect(dailyModeOf({ daily_tasks: { de: 'off' } }, 'de')).toBe('off');
  expect(dailyModeLabel('daily')).toBe('Every day');
});

test('Toki Pona has no daily task until one is chosen for it, as the server reads it', () => {
  expect(dailyModeOf({}, 'tok')).toBe('off');
  expect(dailyModeOf({ daily_tasks: { tok: 'daily' } }, 'tok')).toBe('daily');
  expect(dailyTasksSummary({ daily_tasks: { tok: 'daily' } })).toBe('Toki Pona every day, 1 rotating a day');
});

test('the rotation count stays within the stepper', () => {
  expect(clampRotateCount(0)).toBe(1);
  expect(clampRotateCount(99)).toBe(10);
  expect(clampRotateCount(2.4)).toBe(2);
});

test('the summary names the Every day languages and says how many rotate a day', () => {
  const all = Object.fromEntries(['th', 'es', 'fr', 'de', 'el', 'en', 'ja', 'nb', 'pl', 'ru'].map((l) => [l, 'off']));
  expect(dailyTasksSummary({ daily_tasks: { ...all, th: 'daily' } })).toBe('Thai every day');
  expect(dailyTasksSummary({ daily_tasks: { ...all, th: 'daily', de: 'rotate', pl: 'rotate' }, daily_rotate_count: 1 })).toBe('Thai every day, 1 rotating a day');
  // More turns a day than languages that rotate is only as many as rotate.
  expect(dailyTasksSummary({ daily_tasks: { ...all, de: 'rotate' }, daily_rotate_count: 3 })).toBe('1 rotating a day');
  expect(dailyTasksSummary({ daily_tasks: all })).toBe('No daily tasks');
  // Every language rotates until chosen otherwise.
  expect(dailyTasksSummary({ daily_tasks: {} })).toBe('1 rotating a day');
  // A server from before the setting says nothing.
  expect(dailyTasksSummary({})).toBeNull();
  expect(dailyTasksSummary(null)).toBeNull();
});
