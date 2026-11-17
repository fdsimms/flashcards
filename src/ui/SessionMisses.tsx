import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { headword } from '../core/forms';
import { htmlToText } from '../core/html';
import { missReasonsFor } from '../core/misses';
import type { AnswerRecord } from '../core/session';
import { missedCardText, type MissedCardText } from '../core/missedCard';
import type { Card, Note, NoteType } from '../core/types';
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
 * what Similar words can practice of them (src/tools/mixups.ts): those missed on how a word
 * sounds by ear, the rest by meaning, each among the words it's confused with. Practicing changes
 * nothing about when the cards come back. `practicable` false (no route to the tool) offers none.
 */
export function useSessionMisses(history: AnswerRecord[], notes: Map<string, Note>, cards: Card[] | null, practicable: boolean, noteTypes: Map<string, NoteType>) {
  const missed = useMemo(() => history.filter((h) => h.rating === 1).map((h) => ({ noteId: h.before.noteId, kind: h.before.kind, cardId: h.before.id, miss: h.miss })), [history]);
  // An Anki note type's card once (its question and answer say which card), any other note once,
  // each with its latest reason.
  const rows = useMemo(() => {
    const latest = new Map<string, (typeof missed)[number] & { card?: MissedCardText }>();
    for (const m of missed) {
      const note = notes.get(m.noteId);
      const card = note ? missedCardText(note, noteTypes.get(note.model), m.kind) : undefined;
      const key = card ? m.cardId : m.noteId;
      latest.delete(key);
      latest.set(key, { ...m, card });
    }
    return [...latest].flatMap(([key, m]) => {
      const note = notes.get(m.noteId);
      if (!note) return [];
      const reason = m.miss ? missReasonsFor(note).find((r) => r.key === m.miss)?.label : undefined;
      return [{ key, noteId: m.noteId, word: headword(note), meaning: htmlToText(note.fields.Meaning ?? '').replace(/\s+/g, ' ').trim(), card: m.card, reason }];
    });
  }, [missed, notes, noteTypes]);
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

/** The list of words missed this session. */
export function SessionMissList({ rows }: { rows: SessionMissRow[] }) {
  const c = useTheme();
  if (!rows.length) return null;
  return (
    <View style={{ alignSelf: 'stretch', gap: space.s, marginTop: space.l }}>
      <Text style={{ ...type.overline, color: c.textSecondary, paddingHorizontal: space.xs }}>Missed this session</Text>
      <View style={{ backgroundColor: c.surface, borderRadius: radius.m, ...smooth, borderWidth: hairline, borderColor: c.border, overflow: 'hidden' }}>
        {rows.slice(0, SHOWN).map((r, i) => (
          <View
            key={r.key}
            accessible
            accessibilityLabel={`${r.card ? `${r.card.question}, ${r.card.answer}` : `${r.word}, ${r.meaning}`}${r.reason ? `, missed on ${r.reason.toLowerCase()}` : ''}`}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: 44,
              borderTopWidth: i ? hairline : 0, borderTopColor: c.border,
            }}
          >
            {r.card ? (
              <View style={{ flex: 1, gap: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
                  <Text numberOfLines={1} style={{ ...type.footnote, color: c.textSecondary, flexShrink: 1 }}>{r.card.question}</Text>
                  {r.card.cardName ? <Text numberOfLines={1} style={{ ...type.footnote, color: c.textSecondary, flexShrink: 1 }}>{r.card.cardName}</Text> : null}
                </View>
                <Text style={{ ...type.body, color: c.text }}>{r.card.answer}</Text>
              </View>
            ) : (
              <>
                <Text style={{ ...type.body, color: c.text }}>{r.word}</Text>
                <Text numberOfLines={1} style={{ ...type.subhead, color: c.textSecondary, flex: 1 }}>{r.meaning}</Text>
              </>
            )}
            {r.reason ? (
              <View style={{ backgroundColor: c.dangerFill, borderRadius: radius.pill, paddingHorizontal: space.s, paddingVertical: 2 }}>
                <Text style={{ ...type.footnote, color: c.danger }}>{r.reason}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>
      {rows.length > SHOWN ? <Text style={{ ...type.footnote, color: c.textSecondary, paddingHorizontal: space.xs }}>{`And ${rows.length - SHOWN} more.`}</Text> : null}
    </View>
  );
}
