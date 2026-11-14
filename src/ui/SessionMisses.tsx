import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { headword } from '../core/forms';
import { htmlToText } from '../core/html';
import { missReasonsFor } from '../core/misses';
import type { AnswerRecord } from '../core/session';
import type { Card, Note } from '../core/types';
import type { Language } from '../reader/api';
import { missedPracticeLabel, mixupSet, practiceFromMisses, type MixupMode } from '../tools/mixups';
import { hairline, radius, smooth, space, type, useTheme } from './theme';

/** How many missed words the list shows before counting the rest. */
const SHOWN = 8;

export interface MixupRequest {
  noteIds: string[];
  mode: MixupMode;
  language: Language;
}

/**
 * At a session's end: the words answered Again, each with the reason chosen on Again's menu, and
 * what Words you mix up can practice of them (src/tools/mixups.ts): those missed on how a word
 * sounds by ear, the rest by meaning, each among the words it's confused with. Practicing changes
 * nothing about when the cards come back. `practicable` false (no route to the tool) offers none.
 */
export function useSessionMisses(history: AnswerRecord[], notes: Map<string, Note>, cards: Card[] | null, practicable: boolean) {
  const missed = useMemo(() => history.filter((h) => h.rating === 1).map((h) => ({ noteId: h.before.noteId, miss: h.miss })), [history]);
  // Each note once, with its latest reason.
  const rows = useMemo(() => {
    const latest = new Map<string, string | undefined>();
    for (const m of missed) { latest.delete(m.noteId); latest.set(m.noteId, m.miss); }
    return [...latest].flatMap(([noteId, miss]) => {
      const note = notes.get(noteId);
      if (!note) return [];
      const reason = miss ? missReasonsFor(note).find((r) => r.key === miss)?.label : undefined;
      return [{ noteId, word: headword(note), meaning: htmlToText(note.fields.Meaning ?? '').replace(/\s+/g, ' ').trim(), reason }];
    });
  }, [missed, notes]);
  const practice = useMemo(() => {
    if (!practicable || !missed.length || !cards) return [];
    const studied = new Set(cards.filter((card) => card.sched.state !== 0).map((card) => card.noteId));
    const labelOf = (key: string | undefined, noteId: string) => {
      const note = notes.get(noteId);
      return key && note ? missReasonsFor(note).find((r) => r.key === key)?.label : undefined;
    };
    return practiceFromMisses(missed, mixupSet(notes.values(), studied)).map((p) => ({
      label: missedPracticeLabel(p, labelOf(p.reason, p.noteIds[0])),
      request: { noteIds: p.noteIds, mode: p.mode, language: p.language } as MixupRequest,
    }));
  }, [practicable, missed, notes, cards]);
  return { rows, practice };
}

export type SessionMissRow = ReturnType<typeof useSessionMisses>['rows'][number];

/** The list of words missed this session, with a line under it when some can be practiced. */
export function SessionMissList({ rows, practicable }: { rows: SessionMissRow[]; practicable: boolean }) {
  const c = useTheme();
  if (!rows.length) return null;
  return (
    <View style={{ alignSelf: 'stretch', gap: space.s, marginTop: space.l }}>
      <Text style={{ ...type.overline, color: c.textSecondary, paddingHorizontal: space.xs }}>Missed this session</Text>
      <View style={{ backgroundColor: c.surface, borderRadius: radius.m, ...smooth, borderWidth: hairline, borderColor: c.border, overflow: 'hidden' }}>
        {rows.slice(0, SHOWN).map((r, i) => (
          <View
            key={r.noteId}
            accessible
            accessibilityLabel={`${r.word}, ${r.meaning}${r.reason ? `, missed on ${r.reason.toLowerCase()}` : ''}`}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: 44,
              borderTopWidth: i ? hairline : 0, borderTopColor: c.border,
            }}
          >
            <Text style={{ ...type.body, color: c.text }}>{r.word}</Text>
            <Text numberOfLines={1} style={{ ...type.subhead, color: c.textSecondary, flex: 1 }}>{r.meaning}</Text>
            {r.reason ? (
              <View style={{ backgroundColor: c.dangerFill, borderRadius: radius.pill, paddingHorizontal: space.s, paddingVertical: 2 }}>
                <Text style={{ ...type.footnote, color: c.danger }}>{r.reason}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>
      {rows.length > SHOWN ? <Text style={{ ...type.footnote, color: c.textSecondary, paddingHorizontal: space.xs }}>{`And ${rows.length - SHOWN} more.`}</Text> : null}
      {practicable ? (
        <Text style={{ ...type.footnote, color: c.textSecondary, paddingHorizontal: space.xs }}>
          Each word comes up among the ones it's mixed up with. Practicing doesn't change when its cards come back.
        </Text>
      ) : null}
    </View>
  );
}
