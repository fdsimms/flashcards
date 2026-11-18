import { AGENT_FLAG_REASONS, type AgentFlagReason } from './agentFlag';
import { readerLanguageOf } from './leechHint';
import type { Note } from './types';
import type { Language } from '../reader/api';

/**
 * Fix with Claude now: a flagged card's fix, suggested by Read & Listen's server and applied only when
 * the owner taps Apply. The server answers with each changed field's whole new value; this checks the
 * answer again before it's shown (the server's own check could be older than the app) and writes the
 * accepted fields back. Nothing here schedules or grades a card.
 */

/** What the server is asked: the note's fields as stored, why it was flagged, and what the owner typed. */
export interface FixRequest {
  language?: Language;
  fields: Record<string, string>;
  reason: string;
  note: string;
}

/** What the server answers. */
export interface FixResponse {
  changes: Record<string, string>;
  explanation: string;
}

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export interface FixProposal {
  changes: FieldChange[];
  explanation: string;
  /** Suggested changes that were left out because they'd drop or add a recording or image; the sheet says how many. */
  skipped: number;
}

export function fixRequest(note: Note, reason: AgentFlagReason, text: string): FixRequest {
  const label = AGENT_FLAG_REASONS.find((r) => r.slug === reason)?.label ?? reason;
  return { language: readerLanguageOf(note), fields: note.fields, reason: label, note: text.trim() };
}

/** The recording and image references in a field, in order: a fix may not add, drop or move them. */
function mediaIn(html: string): string {
  return (html.match(/\[sound:[^\]]*\]|<img\b[^>]*>/gi) ?? []).join('\n');
}

/**
 * The fix as the owner should see it: only fields the note has, only ones that change, each at most
 * once, and none whose recordings or images differ from what's there now. A change left out for the
 * media rule is counted in `skipped`, never dropped without a word.
 */
export function checkFix(note: Note, response: FixResponse): FixProposal {
  const changes: FieldChange[] = [];
  let skipped = 0;
  for (const [field, after] of Object.entries(response.changes ?? {})) {
    const before = note.fields[field];
    if (before === undefined || typeof after !== 'string' || after === before) continue;
    if (mediaIn(before) !== mediaIn(after)) { skipped++; continue; }
    changes.push({ field, before, after });
  }
  return { changes, explanation: (response.explanation ?? '').trim(), skipped };
}

/** The note's fields with the proposal's changes written in. */
export function withFix(fields: Record<string, string>, proposal: FixProposal): Record<string, string> {
  const next = { ...fields };
  for (const c of proposal.changes) next[c.field] = c.after;
  return next;
}
