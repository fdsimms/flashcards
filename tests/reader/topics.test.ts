import { describe, expect, it } from 'vitest';
import { TOPIC_IDEAS, TOPIC_TITLE_MAX, topicFocus, topicIdeas, topicLine, topicTitle, topicWriting } from '../../src/reader/topics';
import { LANGUAGE_ORDER } from '../../src/reader/languages';

const H = 4;
const NOW = new Date(2026, 10, 15, 12);
const row = (status: 'writing' | 'ready' | 'failed', created: Date) => ({ id: 1, title: 'Serial verbs', status, created_at: created.toISOString() });

describe('your topics', () => {
  it('sends a title with its spaces collapsed, and nothing for a blank one', () => {
    expect(topicTitle('  Serial   verbs ')).toBe('Serial verbs');
    expect(topicTitle('   ')).toBe('');
    expect(topicTitle('x'.repeat(200))).toHaveLength(TOPIC_TITLE_MAX);
  });

  it('says what a topic is under its name, by study days', () => {
    expect(topicLine(row('ready', new Date(2026, 10, 12, 12)), NOW, H)).toBe('Written by Claude · 3 days ago');
    expect(topicLine(row('ready', new Date(2026, 10, 15, 1)), NOW, H)).toBe('Written by Claude · yesterday');
    expect(topicLine(row('writing', NOW), NOW, H)).toBe('Being written');
    expect(topicLine(row('failed', NOW), NOW, H)).toContain("Couldn't be written");
  });

  it('knows a page is still being written only while it says so', () => {
    expect(topicWriting({ status: 'writing' })).toBe(true);
    expect(topicWriting({ status: 'ready' })).toBe(false);
    expect(topicWriting({ status: 'failed' })).toBe(false);
  });

  it('hands Situations the title and the idea', () => {
    expect(topicFocus({ title: 'Serial verbs', lead: 'Verbs in a row' })).toEqual({ title: 'Serial verbs', lead: 'Verbs in a row' });
  });

  it('suggests ideas for every language, leaving out topics already written', () => {
    for (const l of LANGUAGE_ORDER) expect(TOPIC_IDEAS[l]?.length, l).toBeGreaterThanOrEqual(4);
    expect(topicIdeas('th', [{ title: 'serial VERBS' }])).not.toContain('Serial verbs');
    expect(topicIdeas('th', [])).toContain('Serial verbs');
  });

  it('writes no em dashes in what it shows', () => {
    const all = Object.values(TOPIC_IDEAS).flat().join('');
    expect(all).not.toContain('—');
  });
});
